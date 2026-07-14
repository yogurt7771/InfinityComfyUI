import { expect, test, type Page } from '@playwright/test'

type SourceRenderCase = {
  latestHeading: string
  latestSource: string
  oldHeading: string
  oldSource: string
  renderedMode: 'render html' | 'render markdown'
  sourceMode: 'html' | 'markdown'
}

const cases: SourceRenderCase[] = [
  {
    sourceMode: 'markdown',
    renderedMode: 'render markdown',
    oldSource: '# Old markdown heading',
    latestSource: '# Latest markdown heading',
    oldHeading: 'Old markdown heading',
    latestHeading: 'Latest markdown heading',
  },
  {
    sourceMode: 'html',
    renderedMode: 'render html',
    oldSource: '<h2>Old HTML heading</h2>',
    latestSource: '<h2>Latest HTML heading</h2>',
    oldHeading: 'Old HTML heading',
    latestHeading: 'Latest HTML heading',
  },
]

async function createTextAsset(page: Page) {
  await page.goto('/')
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 260, y: 360 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  return {
    displayMode: page.getByRole('combobox', { name: 'Prompt display mode' }),
    source: page.getByRole('textbox', { name: 'Prompt source' }),
  }
}

for (const scenario of cases) {
  test(`switching ${scenario.sourceMode} directly to ${scenario.renderedMode} renders and preserves the latest unblurred edit`, async ({
    page,
  }) => {
    const editor = await createTextAsset(page)
    await editor.displayMode.selectOption(scenario.sourceMode)

    await editor.source.fill(scenario.oldSource)
    await editor.source.blur()
    await expect(editor.source).toHaveValue(scenario.oldSource)

    await editor.source.fill(scenario.latestSource)
    await editor.displayMode.selectOption(scenario.renderedMode)

    const rendered = page.getByRole('region', {
      name: `Prompt rendered ${scenario.renderedMode.replace('render ', '')}`,
    })
    await expect(rendered).toBeVisible()
    const renderedHeadings = await rendered.getByRole('heading').allTextContents()
    expect.soft(renderedHeadings).toContain(scenario.latestHeading)
    expect.soft(renderedHeadings).not.toContain(scenario.oldHeading)

    await editor.displayMode.selectOption(scenario.sourceMode)
    expect.soft(await page.getByRole('textbox', { name: 'Prompt source' }).inputValue()).toBe(scenario.latestSource)
  })
}
