import React, { createElement as h } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components = {
  table: ({ children }) => h("div", { className: "assistant-table" },
    h("div", { className: "assistant-table-hint" }, "Bảng dữ liệu · Cuộn ngang để xem đầy đủ"),
    h("div", { className: "assistant-table-scroll", role: "region", "aria-label": "Bảng trong câu trả lời AI", tabIndex: 0 }, h("table", null, children))),
  a: ({ href, children }) => href
    ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, children)
    : h("span", null, children),
  // Model-generated images must not cause unsolicited external requests.
  img: ({ alt }) => h("span", { className: "assistant-image-alt" }, alt || "Hình ảnh"),
};

const plainText = node => node.type === "text" ? node.value : (node.children || []).map(plainText).join("");
const normalizeTitle = value => value.normalize("NFC").replace(/\s+/g, " ").trim();
const findLink = node => node.tagName === "a" ? node : node.children?.map(findLink).find(Boolean);

export default React.memo(function AssistantMarkdown({ content, references = [], onOpenTask, selectedTaskId }) {
  const taskComponents = React.useMemo(() => {
    if (!onOpenTask) return components;
    const byHref = new Map(references.map(task => [`/tasks/${encodeURIComponent(task.id)}`, task]));
    const taskInCell = node => {
      const linked = findLink(node);
      if (linked) return byHref.get(linked.properties?.href);
      const matches = references.filter(task => normalizeTitle(task.title) === normalizeTitle(plainText(node)));
      return matches.length === 1 ? matches[0] : null;
    };
    const taskLink = (task, children) => h("button", {
      type: "button", className: `assistant-task-link${task.id === selectedTaskId ? " is-selected" : ""}`,
      onClick: () => onOpenTask(task), "aria-label": `Mở công việc ${task.title}`,
      "aria-pressed": task.id === selectedTaskId,
    }, children);
    return {
      ...components,
      a: props => byHref.has(props.href) ? taskLink(byHref.get(props.href), props.children) : components.a(props),
      td: ({ node, children, ...props }) => {
        const task = taskInCell(node);
        // Explicit links are rendered by `a`; never nest interactive controls.
        const hasLink = findLink(node);
        return h("td", props, task && !hasLink ? taskLink(task, children) : children);
      },
      tr: ({ node, children }) => h("tr", {
        className: selectedTaskId && node.children?.some(cell => cell.tagName === "td" && taskInCell(cell)?.id === selectedTaskId) ? "is-selected-task" : undefined,
      }, children),
    };
  }, [references, onOpenTask, selectedTaskId]);
  return h("div", { className: "assistant-markdown" },
    h(ReactMarkdown, { remarkPlugins: [remarkGfm], components: taskComponents, skipHtml: true }, content));
});
