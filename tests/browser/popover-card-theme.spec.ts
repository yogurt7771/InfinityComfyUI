import { expect, test, type Locator, type Page } from '@playwright/test'

type Theme = 'light' | 'dark'

async function useTheme(page: Page, theme: Theme) {
  const workbench = page.getByLabel('Infinity ComfyUI workbench')
  await expect(workbench).toHaveAttribute('data-theme', 'light')
  if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(workbench).toHaveAttribute('data-theme', theme)
  await page.waitForTimeout(250)
}

async function addOperationHistory(page: Page) {
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 260, y: 360 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  const source = page.getByRole('textbox', { name: 'Prompt source' })
  await source.fill('history contrast sample')
  await source.blur()
}

async function addFunctionFromPopover(page: Page) {
  await page.getByRole('button', { name: 'Functions' }).click()
  const popover = page.getByRole('region', { name: 'Functions popover' })
  await popover.getByRole('button', { name: 'New function' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Function' })
  await dialog.getByLabel('Function type').selectOption('request')
  await dialog.getByLabel('Function name').fill('Contrast Function')
  await dialog.getByLabel('Request URL').fill('https://example.invalid/contrast')
  await dialog.getByRole('button', { name: 'Save function' }).click()
  await expect(dialog).toHaveCount(0)
  return popover
}

async function computedCardReadability(
  card: Locator,
  selectors: { container: string; metadata: string; status: string; title: string },
) {
  return card.evaluate((element, targetSelectors) => {
    type Color = { alpha: number; blue: number; green: number; red: number }

    const parseColor = (value: string): Color => {
      const match = value.match(/^rgba?\(([^)]+)\)$/)
      if (!match) throw new Error(`unsupported computed color: ${value}`)
      const channels = match[1].split(/[,\s/]+/).filter(Boolean).map(Number)
      return {
        red: channels[0],
        green: channels[1],
        blue: channels[2],
        alpha: channels.length > 3 ? channels[3] : 1,
      }
    }
    const composite = (foreground: Color, background: Color): Color => {
      const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
      if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 }
      return {
        red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
        green:
          (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) /
          alpha,
        blue:
          (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) /
          alpha,
        alpha,
      }
    }
    const effectiveBackground = (target: Element): Color => {
      const layers: Color[] = []
      for (let current: Element | null = target; current; current = current.parentElement) {
        layers.push(parseColor(getComputedStyle(current).backgroundColor))
      }
      return layers
        .reverse()
        .reduce((background, foreground) => composite(foreground, background), {
          red: 255,
          green: 255,
          blue: 255,
          alpha: 1,
        })
    }
    const luminance = (color: Color) => {
      const linear = [color.red, color.green, color.blue].map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const contrast = (foreground: Color, background: Color) => {
      const foregroundLuminance = luminance(composite(foreground, background))
      const backgroundLuminance = luminance(background)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }
    const required = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector)
      if (!target) throw new Error(`card content not found: ${selector}`)
      return target
    }
    const textContrast = (target: HTMLElement) =>
      contrast(parseColor(getComputedStyle(target).color), effectiveBackground(target))

    const container = element.closest(targetSelectors.container)
    if (!container) throw new Error(`card container not found: ${targetSelectors.container}`)
    const cardBackground = effectiveBackground(element)
    const containerBackground = effectiveBackground(container)
    return {
      cardSurfaceLuminance: luminance(cardBackground),
      containerSurfaceLuminance: luminance(containerBackground),
      metadataContrast: textContrast(required(targetSelectors.metadata)),
      statusContrast: textContrast(required(targetSelectors.status)),
      titleContrast: textContrast(required(targetSelectors.title)),
    }
  }, selectors)
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} History and Functions cards keep theme-appropriate surfaces and readable text`, async ({ page }) => {
    await page.goto('/')
    await useTheme(page, theme)
    await addOperationHistory(page)

    await page.getByRole('button', { name: 'History' }).click()
    const historyCard = page.getByLabel('Operation history list').locator('article').first()
    await expect(historyCard).toBeVisible()
    const history = await computedCardReadability(historyCard, {
      container: '.operation-history-list',
      title: '.history-command-main strong',
      metadata: '.history-command-main small',
      status: '.history-command-main small span:last-child',
    })

    await page.getByRole('button', { name: 'History' }).click()
    const functionsPopover = await addFunctionFromPopover(page)
    const functionCard = functionsPopover.getByLabel('Function list').locator('article').filter({ hasText: 'Contrast Function' })
    await expect(functionCard).toBeVisible()
    const functionItem = await computedCardReadability(functionCard, {
      container: '.function-management-list',
      title: '.dock-management-copy strong',
      metadata: '.dock-management-copy small',
      status: '.dock-management-item em',
    })

    const surfaceExpectation = theme === 'dark'
      ? { cardMaximum: 0.2, containerMaximum: 0.2 }
      : { cardMinimum: 0.65, containerMinimum: 0.65 }
    if (theme === 'dark') {
      expect.soft(history.cardSurfaceLuminance, 'History card surface').toBeLessThanOrEqual(surfaceExpectation.cardMaximum ?? 0)
      expect.soft(history.containerSurfaceLuminance, 'History list surface').toBeLessThanOrEqual(surfaceExpectation.containerMaximum ?? 0)
      expect.soft(functionItem.cardSurfaceLuminance, 'Function card surface').toBeLessThanOrEqual(surfaceExpectation.cardMaximum ?? 0)
      expect.soft(functionItem.containerSurfaceLuminance, 'Function list surface').toBeLessThanOrEqual(surfaceExpectation.containerMaximum ?? 0)
    } else {
      expect.soft(history.cardSurfaceLuminance, 'History card surface').toBeGreaterThanOrEqual(surfaceExpectation.cardMinimum ?? 1)
      expect.soft(history.containerSurfaceLuminance, 'History list surface').toBeGreaterThanOrEqual(surfaceExpectation.containerMinimum ?? 1)
      expect.soft(functionItem.cardSurfaceLuminance, 'Function card surface').toBeGreaterThanOrEqual(surfaceExpectation.cardMinimum ?? 1)
      expect.soft(functionItem.containerSurfaceLuminance, 'Function list surface').toBeGreaterThanOrEqual(surfaceExpectation.containerMinimum ?? 1)
    }

    for (const [label, readability] of [['History', history], ['Function', functionItem]] as const) {
      expect.soft(readability.titleContrast, `${label} title contrast`).toBeGreaterThanOrEqual(4.5)
      expect.soft(readability.metadataContrast, `${label} metadata contrast`).toBeGreaterThanOrEqual(4.5)
      expect.soft(readability.statusContrast, `${label} status contrast`).toBeGreaterThanOrEqual(4.5)
    }
  })
}
