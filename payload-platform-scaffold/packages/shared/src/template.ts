/**
 * 渲染 {{key}} 占位符模板。
 * 用于 Prompt 模板和系统消息组装。
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | number | undefined | null>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = variables[key]
    return value === undefined || value === null ? '' : String(value)
  })
}
