const cjkChar = "\u3400-\u9fff\uf900-\ufaff";
const cjkPunctuation = "，。！？；：、";
const closingPunctuation = "）】》〉」』";
const openingPunctuation = "（【《〈「『";
const optionLinePattern = /^(?:[A-D][.．、]|[（(][A-D][）)]|[①②③④⑤⑥⑦⑧⑨⑩])(?:\s|$)/;
const numberedLinePattern = /^(?:\d{1,3}|[一二三四五六七八九十]{1,4})[.．、](?:\s|$)/;
const protectedLinePrefixPattern = /^((?:[A-D][.．、]|[（(][A-D][）)]|[①②③④⑤⑥⑦⑧⑨⑩]|(?:\d{1,3}|[一二三四五六七八九十]{1,4})[.．、]))\s*/;
const sentenceEndPattern = /[。！？!?；;：:）)]$/;

const normalizeMathSpacing = (line: string): string =>
  line
    .replace(/\b([A-Za-z]{1,6})\s+\(\s*([A-Za-z0-9_+\-*/^]+(?:\s*[,，]\s*[A-Za-z0-9_+\-*/^]+)*)\s*\)/g, (_match, name: string, args: string) => {
      const normalizedArgs = args.replace(/\s*[,，]\s*/g, ", ");
      return `${name}(${normalizedArgs})`;
    })
    .replace(/([A-Za-z0-9)\]}])\s*\^\s*([A-Za-z0-9({\[])/g, "$1^$2")
    .replace(/([A-Za-z0-9)\]}])\s*_\s*([A-Za-z0-9({\[])/g, "$1_$2")
    .replace(/\s*([=+×÷≤≥≠≈])\s*/g, " $1 ")
    .replace(/[ \t\f\v\u00a0]{2,}/g, " ")
    .trim();

const normalizeLine = (line: string): string => {
  let normalized = line
    .trim()
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(new RegExp(`\\s+([${cjkPunctuation}${closingPunctuation}])`, "g"), "$1")
    .replace(new RegExp(`([${openingPunctuation}])\\s+`, "g"), "$1")
    .replace(new RegExp(`([${cjkPunctuation}])\\s+([${cjkChar}])`, "g"), "$1$2");

  let compacted = "";
  while (compacted !== normalized) {
    compacted = normalized;
    normalized = normalized.replace(new RegExp(`([${cjkChar}])\\s+([${cjkChar}])`, "g"), "$1$2");
  }

  normalized = normalizeMathSpacing(normalized);
  normalized = normalized
    .replace(new RegExp(`\\s+([${cjkPunctuation}${closingPunctuation}])`, "g"), "$1")
    .replace(new RegExp(`([${openingPunctuation}])\\s+`, "g"), "$1")
    .replace(protectedLinePrefixPattern, "$1 ");

  return normalized;
};

const isProtectedLine = (line: string): boolean =>
  optionLinePattern.test(line) || numberedLinePattern.test(line);

const hasCjk = (line: string): boolean => new RegExp(`[${cjkChar}]`).test(line);

const shouldMergeLine = (previous: string, current: string): boolean => {
  if (!previous || !current) {
    return false;
  }
  if (isProtectedLine(previous) || isProtectedLine(current)) {
    return false;
  }
  if (sentenceEndPattern.test(previous)) {
    return false;
  }
  if (!hasCjk(previous) || !hasCjk(current)) {
    return false;
  }
  return true;
};

const joinLines = (previous: string, current: string): string => {
  if (new RegExp(`[${cjkPunctuation}${openingPunctuation}]$`).test(previous)) {
    return `${previous}${current}`;
  }
  if (new RegExp(`^[${cjkPunctuation}${closingPunctuation}]`).test(current)) {
    return `${previous}${current}`;
  }
  return `${previous} ${current}`;
};

export const cleanupOcrText = (text: string): string => {
  const normalizedLines = text.replace(/\r\n?/g, "\n").split("\n").map(normalizeLine);
  const lines: string[] = [];
  let emptyCount = 0;

  for (const line of normalizedLines) {
    if (!line) {
      emptyCount += 1;
      if (emptyCount <= 2) {
        lines.push("");
      }
      continue;
    }

    emptyCount = 0;
    const previous = lines[lines.length - 1];
    if (previous !== undefined && shouldMergeLine(previous, line)) {
      lines[lines.length - 1] = joinLines(previous, line);
    } else {
      lines.push(line);
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
