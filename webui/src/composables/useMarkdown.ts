import { ref } from 'vue'
import { Marked } from 'marked'
import hljs from 'highlight.js'

const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      const highlighted = hljs.highlight(text, { language }).value
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`
    },
  },
})

export function useMarkdown() {
  function render(source: string): string {
    if (!source) return ''
    return marked.parse(source) as string
  }

  return { render }
}
