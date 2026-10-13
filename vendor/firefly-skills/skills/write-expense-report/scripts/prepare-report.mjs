// 将已逐笔核实、并经用户确认的支出中间数据整理为 write_excel 的参数。
// 只读取输入；中间输出以独占方式创建；不访问账本、不生成 XLSX。
// 用法：node prepare-report.mjs <输入 JSON> <中间输出 JSON> <运行时输出根目录> <新文件名.xlsx>
import { lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

const USAGE = "usage: node prepare-report.mjs INPUT_JSON PREPARED_JSON RUNTIME_OUTPUT_ROOT FILENAME";
const ROOT_FIELDS = ["currency", "records"];
const RECORD_FIELDS = ["date", "category", "amount", "note", "currency"];
const DETAIL_SHEET = "支出明细";
const DETAIL_HEADERS = ["日期", "类目", "金额", "备注"];
const SUMMARY_SHEET = "分类汇总";
const SUMMARY_HEADERS = ["类目", "金额", "币种"];
const TOTAL_LABEL = "合计";
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

// 所有输入类错误都经由这里抛出，前缀固定为 "Invalid input: "。
function rejectInput(detail) {
  throw new Error(`Invalid input: ${detail}`);
}

// 要求对象恰好拥有给定的全部字段：多一个或少一个都不行，数组与非对象同样拒绝。
function assertExactFields(value, fields) {
  const isObject = Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const sameCount = isObject && Object.keys(value).length === fields.length;
  if (!sameCount || !fields.every(field => Object.hasOwn(value, field))) {
    rejectInput(`expected exactly ${fields.join(", ")}`);
  }
}

// 把金额原文按十进制 half-up 舍入到分，得到 BigInt 形式的分值。全程不使用二进制浮点。
function amountToCents(text) {
  if (typeof text !== "string" || text.length > 100 || !/^\d+(?:\.\d+)?$/.test(text)) {
    rejectInput("amount must be an unsigned decimal string, without exponent notation");
  }
  const [wholePart, fractionPart = ""] = text.split(".");
  const roundUp = fractionPart.length > 2 && fractionPart.charAt(2) >= "5" ? 1n : 0n;
  const cents = BigInt(wholePart) * 100n + BigInt(`${fractionPart}00`.slice(0, 2)) + roundUp;
  if (cents <= 0n) rejectInput("expense must round to positive cents");
  centsToNumber(cents); // 仅用于校验：安全范围与 Excel 数字精度。
  return cents;
}

// 分值 -> Excel 数字。必须不超过安全整数，并且 toFixed(2) 能精确还原成同一个两位小数文本。
function centsToNumber(cents) {
  if (cents > MAX_SAFE_CENTS) rejectInput("amount or total exceeds safe cents");
  const text = `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
  const numeric = Number(text);
  if (numeric.toFixed(2) !== text) rejectInput("amount or total cannot retain exact cents in Excel numbers");
  return numeric;
}

// 日期必须是 YYYY-MM-DD 且为真实存在的公历日（例如 2 月 30 日会被拒绝）。
function assertConfirmedDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    rejectInput("date must be a confirmed YYYY-MM-DD calendar date");
  }
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) {
    rejectInput("date is not a valid calendar date");
  }
}

// 汇总排序：小计按分值降序；小计相同时按类目名称的码元顺序升序。
function bySubtotalThenName([nameA, centsA], [nameB, centsB]) {
  if (centsA !== centsB) return centsA > centsB ? -1 : 1;
  if (nameA === nameB) return 0;
  return nameA < nameB ? -1 : 1;
}

function buildSheets(input) {
  assertExactFields(input, ROOT_FIELDS);
  const { currency, records } = input;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    rejectInput("currency must be an explicitly confirmed three-letter uppercase code");
  }
  if (!Array.isArray(records) || records.length === 0) rejectInput("records must be nonempty");

  // 使用 Map 而非普通对象，避免 "constructor"、"__proto__" 等名称与对象原型冲突。
  const subtotals = new Map();
  let grandCents = 0n;
  const detailRows = records.map((record) => {
    assertExactFields(record, RECORD_FIELDS);
    assertConfirmedDate(record.date);
    if (typeof record.category !== "string" || !record.category.trim()) rejectInput("category is required");
    if (typeof record.note !== "string") rejectInput("note must be text, including an explicit empty string");
    if (record.currency !== currency) rejectInput("mixed or missing currency; no conversion is performed");
    const cents = amountToCents(record.amount);
    grandCents += cents;
    subtotals.set(record.category, (subtotals.get(record.category) ?? 0n) + cents);
    return [record.date, record.category, centsToNumber(cents), record.note];
  });

  const summaryRows = [...subtotals.entries()]
    .sort(bySubtotalThenName)
    .map(([category, cents]) => [category, centsToNumber(cents), currency]);
  summaryRows.push([TOTAL_LABEL, centsToNumber(grandCents), currency]);

  return [
    { name: DETAIL_SHEET, headers: [...DETAIL_HEADERS], rows: detailRows },
    { name: SUMMARY_SHEET, headers: [...SUMMARY_HEADERS], rows: summaryRows },
  ];
}

function readInputDocument(inputPath) {
  try {
    return JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) rejectInput("malformed JSON");
    throw error;
  }
}

// 只要目标路径存在（文件、目录或链接，包括断开的链接）就拒绝。lstat 不跟随符号链接。
function assertWorkbookTargetFree(workbookPath) {
  let occupied = false;
  try {
    lstatSync(workbookPath);
    occupied = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (occupied) throw new Error("Output exists: workbook path; choose a new confirmed filename");
}

// flag "wx" 保证中间输出是新建的；已有文件不会被覆盖。
function writePreparedDocument(preparedPath, payload) {
  try {
    writeFileSync(preparedPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Output exists: prepared JSON; choose a new path");
    throw error;
  }
}

function run() {
  const [inputPath, preparedPath, outputRoot, filename, ...unexpected] = process.argv.slice(2);
  if (!inputPath || !preparedPath || !outputRoot || !filename || unexpected.length > 0) rejectInput(USAGE);
  if (![inputPath, preparedPath, outputRoot].every(candidate => isAbsolute(candidate))) {
    rejectInput("input, prepared output and runtime output root must be absolute paths");
  }
  if (/[\\/<>:"|?*]/.test(filename) || filename.includes("..") || extname(filename) !== ".xlsx") {
    rejectInput("filename must be one new .xlsx filename, without directories or unsafe characters");
  }
  if (!statSync(outputRoot).isDirectory()) rejectInput("runtime output root must be an existing directory");

  const workbookPath = resolve(outputRoot, filename);
  const payload = { filename, sheets: buildSheets(readInputDocument(inputPath)) };
  if (resolve(preparedPath) === resolve(workbookPath)) rejectInput("prepared JSON must not be the workbook");
  assertWorkbookTargetFree(workbookPath);
  writePreparedDocument(preparedPath, payload);
}

try {
  run();
} catch (error) {
  process.stderr.write(`[expense-report] ${error.message}\n`);
  process.exitCode = 1;
}
