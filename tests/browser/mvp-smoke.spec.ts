import { expect, test, type Locator, type Page } from '@playwright/test'

type BrowserFile = {
  name: string
  type: string
  content: string
}

async function dropFiles(page: Page, target: Locator, files: BrowserFile[], point = { x: 520, y: 360 }) {
  const handle = await target.elementHandle()
  if (!handle) throw new Error('Drop target not found')

  await handle.evaluate(
    (element, payload) => {
      const transfer = new DataTransfer()
      for (const file of payload.files) {
        transfer.items.add(new File([file.content], file.name, { type: file.type }))
      }

      element.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: payload.point.x,
          clientY: payload.point.y,
        }),
      )
      element.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: payload.point.x,
          clientY: payload.point.y,
        }),
      )
    },
    { files, point },
  )
}

async function expectNoObjectObject(page: Page) {
  await expect.poll(async () => (await page.locator('body').innerText()).includes('[object Object]')).toBe(false)
}

async function nodeTranslate(locator: Locator) {
  const transform = await locator.evaluate((element) => getComputedStyle(element).transform)
  const match = transform.match(/matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([-0-9.]+),\s*([-0-9.]+)\)/)
  if (match) return { x: Number(match[1]), y: Number(match[2]) }
  const translateMatch = transform.match(/translate\(\s*([-0-9.]+)px,\s*([-0-9.]+)px\s*\)/)
  if (translateMatch) return { x: Number(translateMatch[1]), y: Number(translateMatch[2]) }
  return { x: 0, y: 0 }
}

test('supports asset-first canvas creation, preview, drop, and replacement', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Infinity ComfyUI' })).toBeVisible()
  await expect(page.getByLabel('Asset canvas workspace')).toBeVisible()
  await expect(page.locator('.react-flow__node-function')).toHaveCount(0)
  await expect(page.locator('.react-flow__node-result_group')).toHaveCount(0)

  const canvas = page.getByLabel('Asset canvas workspace')
  await canvas.click({ button: 'right', position: { x: 520, y: 340 } })
  await expect(page.getByRole('menu', { name: 'Asset canvas menu' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Add image asset' }).click()

  const firstAssetNode = page.locator('.asset-canvas-node').first()
  const firstAssetWrapper = page.locator('.react-flow__node-asset').first()
  await expect(firstAssetNode).toBeVisible()
  await expect(firstAssetWrapper).toBeVisible()
  await expect(firstAssetNode).toContainText('Image')
  await expectNoObjectObject(page)

  const cardMetrics = await firstAssetNode.evaluate((element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return {
      display: style.display,
      width: box.width,
      height: box.height,
      background: style.backgroundColor,
    }
  })
  expect(cardMetrics.display).toBe('grid')
  expect(cardMetrics.width).toBeGreaterThanOrEqual(220)
  expect(cardMetrics.height).toBeGreaterThanOrEqual(120)
  expect(cardMetrics.background).not.toBe('rgba(0, 0, 0, 0)')

  const beforeDrag = await nodeTranslate(firstAssetWrapper)
  const firstAssetBox = await firstAssetWrapper.boundingBox()
  if (!firstAssetBox) throw new Error('Asset node is not visible for dragging')
  await page.mouse.move(firstAssetBox.x + 80, firstAssetBox.y + 30)
  await page.mouse.down()
  await page.mouse.move(firstAssetBox.x + 220, firstAssetBox.y + 130, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await nodeTranslate(firstAssetWrapper)).x).toBeGreaterThan(beforeDrag.x + 60)
  await expect.poll(async () => (await nodeTranslate(firstAssetWrapper)).y).toBeGreaterThan(beforeDrag.y + 40)
  const afterDrag = await nodeTranslate(firstAssetWrapper)
  await page.waitForTimeout(5500)
  await page.reload()
  await expect(page.getByLabel('Asset canvas workspace')).toBeVisible()
  await expect(page.locator('.asset-canvas-node').first()).toBeVisible()
  await expect.poll(async () => Math.abs((await nodeTranslate(page.locator('.react-flow__node-asset').first())).x - afterDrag.x)).toBeLessThan(1)
  await expect.poll(async () => Math.abs((await nodeTranslate(page.locator('.react-flow__node-asset').first())).y - afterDrag.y)).toBeLessThan(1)

  await firstAssetNode.click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Asset canvas menu' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Add image asset' })).toHaveCount(0)
  await page.mouse.click(20, 20)

  await firstAssetNode.locator('.asset-canvas-node-preview').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const beforeBatchCount = await page.locator('.asset-canvas-node').count()
  await dropFiles(
    page,
    canvas,
    [
      { name: 'render.png', type: 'image/png', content: 'fake png bytes' },
      { name: 'prompt.txt', type: 'text/plain', content: 'warm kitchen prompt' },
    ],
    { x: 640, y: 420 },
  )
  await expect.poll(async () => page.locator('.asset-canvas-node').count()).toBeGreaterThanOrEqual(beforeBatchCount + 2)
  await expect(canvas.getByText('render.png')).toBeVisible()
  await expect(canvas.getByText('prompt.txt')).toBeVisible()
  await expectNoObjectObject(page)

  const afterBatchCount = await page.locator('.asset-canvas-node').count()
  const draggedBatchWrapper = page.locator('.react-flow__node-asset').nth(afterBatchCount - 1)
  const draggedBatchBox = await draggedBatchWrapper.boundingBox()
  if (!draggedBatchBox) throw new Error('Batch asset node is not visible for dragging')
  await page.mouse.move(draggedBatchBox.x + 60, draggedBatchBox.y + 30)
  await page.mouse.down()
  await page.mouse.move(draggedBatchBox.x + 150, draggedBatchBox.y + 100, { steps: 8 })
  await expect(page.locator('.asset-canvas-node')).toHaveCount(afterBatchCount)
  await expect(page.locator('.asset-canvas-node').first()).toBeVisible()
  await expect(page.locator('.comfy-minimap-node-asset')).toHaveCount(afterBatchCount)
  await page.mouse.up()
  await expect(page.locator('.asset-canvas-node')).toHaveCount(afterBatchCount)

  const beforeReplaceCount = await page.locator('.asset-canvas-node').count()
  await dropFiles(
    page,
    page.locator('.asset-canvas-node').first(),
    [{ name: 'replacement.txt', type: 'text/plain', content: 'replacement text asset' }],
    { x: 540, y: 360 },
  )
  await expect(canvas.getByText('replacement.txt')).toBeVisible()
  await expect(page.locator('.asset-canvas-node')).toHaveCount(beforeReplaceCount)
  await expectNoObjectObject(page)
})
