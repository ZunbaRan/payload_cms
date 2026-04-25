/**
 * 飞书机器人 Webhook 封装
 * 使用 msg_type=interactive 发卡片消息，比纯文本信息量更高
 */

const WEBHOOK = process.env.FEISHU_WEBHOOK_URL

async function postFeishu(payload: any): Promise<void> {
  if (!WEBHOOK) {
    console.warn('[feishu] FEISHU_WEBHOOK_URL not set, skip notification')
    return
  }
  try {
    const resp = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      console.error('[feishu] webhook returned', resp.status, await resp.text())
    }
  } catch (err) {
    console.error('[feishu] send failed:', err)
  }
}

/** 纯文本消息 */
export function sendText(text: string): Promise<void> {
  return postFeishu({ msg_type: 'text', content: { text } })
}

/** 卡片消息：标题 + 若干行 + 可选按钮 */
export function sendCard(opts: {
  title: string
  color?: 'blue' | 'green' | 'red' | 'orange' | 'grey'
  lines: string[]
  linkText?: string
  linkUrl?: string
}): Promise<void> {
  const elements: any[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: opts.lines.join('\n'),
      },
    },
  ]
  if (opts.linkUrl && opts.linkText) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: opts.linkText },
          url: opts.linkUrl,
          type: 'primary',
        },
      ],
    })
  }
  return postFeishu({
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: opts.title },
        template: opts.color || 'blue',
      },
      elements,
    },
  })
}
