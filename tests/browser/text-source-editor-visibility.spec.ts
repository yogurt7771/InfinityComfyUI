import { expect, test, type Page } from '@playwright/test'

type SourceMode = 'plaintext' | 'markdown' | 'html' | 'json' | 'yaml'
type Theme = 'light' | 'dark'

const sourceSamples: Record<SourceMode, string> = {
  plaintext: 'plain source text',
  markdown: '# Visible heading\n\n**bold** [link](https://example.com)',
  html: '<section><strong>visible html</strong></section>',
  json: '{"visible": true, "count": 42}',
  yaml: 'visible: true\ncount: 42',
}

async function createTextAsset(page: Page, value: string) {
  await page.goto('/')
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 260, y: 360 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  const source = page.getByRole('textbox', { name: 'Prompt source' })
  await source.fill(value)
  await source.blur()
  await expect(page.locator('.text-source-highlight')).toContainText(value)
  return source
}

async function useTheme(page: Page, theme: Theme) {
  const workbench = page.getByLabel('Infinity ComfyUI workbench')
  await expect(workbench).toHaveAttribute('data-theme', 'light')
  if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(workbench).toHaveAttribute('data-theme', theme)
}

for (const theme of ['light', 'dark'] as const) {
  for (const mode of Object.keys(sourceSamples) as SourceMode[]) {
    test(`${theme} theme keeps the ${mode} source highlight visible through its editable overlay`, async ({ page }) => {
      const source = await createTextAsset(page, sourceSamples[mode])
      await useTheme(page, theme)
      await page.getByRole('combobox', { name: 'Prompt display mode' }).selectOption(mode)
      await source.focus()
      await expect(source).toBeFocused()
      await page.waitForTimeout(250)

      const layers = await source.evaluate((textarea) => {
        const editor = textarea.closest('.text-source-editor')
        const highlight = editor?.querySelector<HTMLElement>('.text-source-highlight')
        const token = highlight?.querySelector<HTMLElement>('.syntax-token')
        if (!highlight || !token) throw new Error('source editor highlight layers not found')

        const textareaStyle = getComputedStyle(textarea)
        const highlightStyle = getComputedStyle(highlight)
        const tokenStyle = getComputedStyle(token)
        const textareaBox = textarea.getBoundingClientRect()
        const highlightBox = highlight.getBoundingClientRect()
        const hasVisibleColor = (value: string) => {
          if (!value || value === 'transparent') return false
          const rgba = value.match(/^rgba?\(([^)]+)\)$/)
          if (!rgba) return true
          const channels = rgba[1].split(/[,\s/]+/).filter(Boolean)
          return channels.length < 4 || Number(channels[3]) > 0
        }

        return {
          textareaBackground: textareaStyle.backgroundColor,
          textareaColor: textareaStyle.color,
          textareaTextFill: textareaStyle.getPropertyValue('-webkit-text-fill-color'),
          caretVisible: hasVisibleColor(textareaStyle.caretColor),
          focusBorderVisible:
            hasVisibleColor(textareaStyle.borderTopColor) &&
            ((textareaStyle.outlineStyle !== 'none' && Number.parseFloat(textareaStyle.outlineWidth) > 0) ||
              textareaStyle.boxShadow !== 'none'),
          highlightVisible:
            highlightStyle.display !== 'none' &&
            highlightStyle.visibility !== 'hidden' &&
            Number.parseFloat(highlightStyle.opacity) > 0,
          highlightTextVisible: hasVisibleColor(tokenStyle.color),
          layersAligned:
            Math.abs(textareaBox.left - highlightBox.left) < 1 &&
            Math.abs(textareaBox.top - highlightBox.top) < 1 &&
            Math.abs(textareaBox.width - highlightBox.width) < 1 &&
            Math.abs(textareaBox.height - highlightBox.height) < 1,
        }
      })

      expect(layers).toEqual({
        textareaBackground: 'rgba(0, 0, 0, 0)',
        textareaColor: 'rgba(0, 0, 0, 0)',
        textareaTextFill: 'rgba(0, 0, 0, 0)',
        caretVisible: true,
        focusBorderVisible: true,
        highlightVisible: true,
        highlightTextVisible: true,
        layersAligned: true,
      })
    })
  }

  test(`${theme} theme keeps rendered markdown and HTML outside the source overlay`, async ({ page }) => {
    await createTextAsset(page, '# Rendered heading')
    await useTheme(page, theme)
    const displayMode = page.getByRole('combobox', { name: 'Prompt display mode' })

    await displayMode.selectOption('render markdown')
    const renderedMarkdown = page.getByRole('region', { name: 'Prompt rendered markdown' })
    await expect(renderedMarkdown).toBeVisible()
    await expect(renderedMarkdown.getByRole('heading', { name: 'Rendered heading' })).toBeVisible()
    await expect(page.locator('.text-source-editor')).toHaveCount(0)

    await displayMode.selectOption('html')
    const htmlSource = page.getByRole('textbox', { name: 'Prompt source' })
    await htmlSource.fill('<h2>Rendered HTML</h2>')
    await htmlSource.blur()
    await expect(page.locator('.text-source-highlight')).toContainText('<h2>Rendered HTML</h2>')
    await displayMode.selectOption('render html')
    const renderedHtml = page.getByRole('region', { name: 'Prompt rendered html' })
    await expect(renderedHtml).toBeVisible()
    await expect(renderedHtml.getByRole('heading', { name: 'Rendered HTML' })).toBeVisible()
    await expect(page.locator('.text-source-editor')).toHaveCount(0)
  })
}
