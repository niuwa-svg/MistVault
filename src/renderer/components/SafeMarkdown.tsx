import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkMath from "remark-math";

const safeProtocols = new Set(["http:", "https:", "mailto:"]);

const isSafeHref = (href: string | undefined): href is string => {
  if (!href) {
    return false;
  }

  try {
    const parsed = new URL(href, "https://mistvault.local");
    return safeProtocols.has(parsed.protocol);
  } catch {
    return false;
  }
};

const components: Components = {
  a: ({ href, children }) =>
    isSafeHref(href) ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: () => null
};

type SafeMarkdownProps = {
  content: string;
};

const normalizeInlineMathDelimiters = (line: string): string => {
  let normalized = "";
  let inlineCode = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "`") {
      inlineCode = !inlineCode;
      normalized += char;
      continue;
    }

    if (!inlineCode && char === "\\" && next === "(") {
      normalized += "$";
      index += 1;
      continue;
    }

    if (!inlineCode && char === "\\" && next === ")") {
      normalized += "$";
      index += 1;
      continue;
    }

    normalized += char;
  }

  return normalized;
};

const normalizeMathDelimiters = (content: string): string => {
  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }

      return inFence ? line : normalizeInlineMathDelimiters(line);
    })
    .join("\n");
};

export const SafeMarkdown = ({ content }: SafeMarkdownProps) => (
  <div className="safe-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[
        rehypeSanitize,
        [
          rehypeKatex,
          {
            trust: false,
            throwOnError: false,
            maxExpand: 1000,
            strict: "warn",
            globalGroup: false
          }
        ]
      ]}
      components={components}
    >
      {normalizeMathDelimiters(content)}
    </ReactMarkdown>
  </div>
);
