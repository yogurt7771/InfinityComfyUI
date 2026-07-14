import { expect, test, type Page } from '@playwright/test'

// Skipped legacy specs cover function-node/manual Workflow JSON/left asset-panel flows.
// They need a rewrite for the asset-first ComfyUI-editor architecture.

const testComfyWorkflow = {
  '6': {
    class_type: 'CLIPTextEncode',
    _meta: { title: 'Positive Prompt' },
    inputs: {
      text: 'warm interior render',
    },
  },
  '3': {
    class_type: 'KSampler',
    _meta: { title: 'Sampler' },
    inputs: {
      seed: 0,
      steps: 24,
      cfg: 7,
    },
  },
  '20': {
    class_type: 'SaveImage',
    _meta: { title: 'Result_Image' },
    inputs: {
      filename_prefix: 'infinity-comfyui',
    },
  },
}

const testWorkflowName = 'Interior Render Workflow'

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  return page.getByRole('dialog', { name: 'Settings' })
}

async function openFunctionManagement(page: Page) {
  await openSettings(page)
  await page.getByRole('button', { name: 'Function Management' }).click()
  return page.getByRole('dialog', { name: 'Function Management' })
}

async function openComfyServerManagement(page: Page) {
  await page.getByRole('button', { name: 'ComfyUI Servers' }).click()
  return page.getByRole('region', { name: 'ComfyUI Servers popover' })
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close Settings' }).click()
}

async function createWorkflowFromFunctionManager(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
  name: string,
  workflow: unknown,
) {
  await dialog.getByRole('button', { name: 'Function', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: 'New Function' })
  await createDialog.getByLabel('Function name').fill(name)
  await createDialog.getByRole('textbox', { name: 'Workflow JSON' }).fill(JSON.stringify(workflow))
  await createDialog.getByRole('button', { name: 'Save function' }).click()
  await expect(createDialog).toHaveCount(0)
  await expect(dialog.getByLabel('Function name')).toHaveValue(name)
}

async function addTestWorkflow(page: Page) {
  const dialog = await openFunctionManagement(page)
  await expect(dialog.getByRole('button', { name: 'Demo' })).toHaveCount(0)
  await createWorkflowFromFunctionManager(page, dialog, testWorkflowName, testComfyWorkflow)
  await dialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)
}

async function disableLocalComfyEndpoint(page: Page) {
  const dialog = await openComfyServerManagement(page)
  await dialog.getByLabel('Endpoint enabled Local ComfyUI').uncheck()
  await dialog.getByRole('button', { name: 'Close ComfyUI Server Management' }).click()
  await closeSettings(page)
}

async function addTextAssetFromCanvas(
  page: Page,
  text = 'sunlit modern kitchen, realistic interior render',
) {
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 180, y: 420 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await page.getByRole('textbox', { name: 'Prompt source' }).fill(text)
}

async function addTextAssetFromCanvasAt(
  page: Page,
  position: { x: number; y: number },
  text: string,
) {
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await page.getByRole('textbox', { name: 'Prompt source' }).last().fill(text)
}

async function addSelectableResourceNodes(page: Page) {
  await addTextAssetFromCanvasAt(page, { x: 220, y: 300 }, 'first selectable prompt')
  await addTextAssetFromCanvasAt(page, { x: 560, y: 360 }, 'second selectable prompt')
  await expect(page.locator('.react-flow__node-resource')).toHaveCount(2)
}

async function addImageAssetByDrop(page: Page) {
  const canvas = page.locator('.workspace-canvas')
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNk+M+ABzAxMiABkDIAUj4CB1G9J4kAAAAASUVORK5CYII='
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'tiny-local.png', { type: 'image/png' }))
    return transfer
  }, pngBase64)

  await canvas.dispatchEvent('dragover', { dataTransfer, clientX: 540, clientY: 240 })
  await canvas.dispatchEvent('drop', { dataTransfer, clientX: 540, clientY: 240 })
  await expect(canvas.getByText('tiny-local.png')).toBeVisible()
}

async function addTestWorkflowNode(page: Page) {
  await addFunctionNodeFromCanvasMenu(page, testWorkflowName)
  await expect(page.locator('.workspace-canvas').getByText(testWorkflowName, { exact: true })).toBeVisible()
}

async function addFunctionNodeFromCanvasMenu(
  page: Page,
  name: string | RegExp,
  position = { x: 720, y: 360 },
) {
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position })
  await page.getByRole('menuitem', { name }).click()
}

async function openBuiltInRunner(
  page: Page,
  name: string,
  position = { x: 720, y: 360 },
) {
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position })
  await page.getByRole('menuitem', { name, exact: true }).click()
  return page.getByRole('dialog', { name: `Run ${name}` })
}

async function connectFirstResourceToFirstFunction(page: Page) {
  const sourceHandle = page.locator('.react-flow__node-resource .react-flow__handle-right').first()
  const targetHandle = page.locator('.react-flow__node-function [data-slot-handle="input:prompt"]').first()
  await expect(sourceHandle).toBeVisible()
  await expect(targetHandle).toBeVisible()
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('demo graph connection handles not found')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
}

async function selectFirstInputEdge(page: Page) {
  const edge = page.locator('.react-flow__edge.input-edge').first()
  await expect(edge).toBeVisible()
  await edge.evaluate((element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  )
  await expect(page.locator('.react-flow__edge.input-edge.selected')).toHaveCount(1)
}

async function createWorkflowGraph(page: Page) {
  await addTestWorkflow(page)
  await addTextAssetFromCanvas(page)
  await addTestWorkflowNode(page)
  await connectFirstResourceToFirstFunction(page)
}

function collectPageErrors(page: Page) {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  return pageErrors
}

test.skip('runs a canvas workflow in a browser', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Infinity ComfyUI' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run MVP' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByLabel('Function list')).toHaveCount(0)
  await expect(page.getByLabel('ComfyUI server list')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ComfyUI Servers' })).toBeVisible()
  await page.getByRole('button', { name: 'ComfyUI Servers' }).click()
  await expect(page.getByLabel('ComfyUI server list')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Packages' })).toHaveCount(0)

  await expect
    .poll(async () =>
      page.evaluate(() => ({
        bodyScrollable: document.documentElement.scrollHeight > window.innerHeight,
        rootHeight: document.getElementById('root')?.getBoundingClientRect().height,
        windowHeight: window.innerHeight,
      })),
    )
    .toMatchObject({
      bodyScrollable: false,
    })

  const canvas = page.locator('.workspace-canvas')
  await disableLocalComfyEndpoint(page)
  await createWorkflowGraph(page)
  await canvas.getByRole('spinbutton', { name: 'Run count' }).fill('3')
  await canvas.getByRole('button', { name: 'Run function' }).click()

  await expect(page.getByText('3 tasks')).toBeVisible()
  await expect(canvas.getByText(testWorkflowName, { exact: true })).toBeVisible()
  await expect(canvas.getByText('Run 1', { exact: true })).toBeVisible()
  await expect(canvas.getByText('Run 2', { exact: true })).toBeVisible()
  await expect(canvas.getByText('Run 3', { exact: true })).toBeVisible()
  await expect(canvas.locator('[data-testid="function-input-slot-prompt"]')).toContainText('Prompt')
  await expect(canvas.locator('[data-testid="function-input-slot-prompt"]')).toContainText('Required')
  await expect(canvas.locator('[data-testid="function-output-slot-image"]')).toContainText('Image')
  await expect(canvas.locator('[data-slot-handle="input:prompt"]')).toHaveCount(1)
  await expect(canvas.locator('[data-slot-handle="output:image"]')).toHaveCount(1)
  await expect(canvas.locator('[data-testid^="result-output-slot-"]')).toHaveCount(3)
  await expect(canvas.locator('[data-slot-handle^="result:"]')).toHaveCount(3)
  await expect(
    canvas.getByLabel('Function output resources').getByRole('button', {
      name: `Open ${testWorkflowName} Run 1.txt output preview`,
    }),
  ).toBeVisible()
  await expect(canvas.getByRole('spinbutton', { name: 'Run count' })).toHaveValue('3')
  await expect(canvas.getByRole('button', { name: 'Copy asset' }).first()).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Download asset' }).first()).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Copy result' })).toHaveCount(3)
  await expect(canvas.getByRole('button', { name: 'Download result' })).toHaveCount(3)
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge.result-edge')).toHaveCount(3)
  await expect(canvas.getByTestId('result-resource-grid').getByText(`Simulated ComfyUI result for ${testWorkflowName} run 1`)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Project Tasks' })).toBeVisible()
  const projectTaskCard = page.locator('.job-card').filter({ hasText: testWorkflowName }).first()
  await expect(projectTaskCard).toContainText(testWorkflowName)
  await expect(projectTaskCard).toContainText('Type')
  await expect(projectTaskCard).toContainText('image')
  await projectTaskCard.getByRole('button', { name: /Interior Render Workflow/ }).click()
  const projectTaskDetails = page.getByLabel('Run execution details')
  await expect(projectTaskDetails).toContainText('Inputs')
  await expect(projectTaskDetails).toContainText('sunlit modern kitchen, realistic interior render')
  await expect(projectTaskDetails).toContainText('Final Workflow')

  const firstResultNode = page.locator('.react-flow__node-result_group').first()
  await firstResultNode.click()
  await expect(firstResultNode.getByRole('button', { name: 'Delete node' })).toBeVisible()
  await expect(firstResultNode.getByRole('button', { name: 'Rerun result' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Run Queue' })).toBeVisible()
  await expect(page.getByLabel('Selected node run history')).toContainText('Run 1/3')
  await expect(page.getByRole('heading', { name: 'Inspector' })).toHaveCount(0)
  await expect
    .poll(async () => {
      const deleteBox = await firstResultNode.getByRole('button', { name: 'Delete node' }).boundingBox()
      const rerunBox = await firstResultNode.getByRole('button', { name: 'Rerun result' }).boundingBox()
      if (!deleteBox || !rerunBox) return false
      return rerunBox.x + rerunBox.width <= deleteBox.x - 6 || deleteBox.x + deleteBox.width <= rerunBox.x - 6
    })
    .toBe(true)
  await canvas.getByText(testWorkflowName, { exact: true }).click()

  await expect
    .poll(async () => {
      const boxes = await page.locator('.react-flow__node-result_group').evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect()
          return { left: Math.round(box.left), top: Math.round(box.top) }
        }),
      )
      if (boxes.length !== 3) return false
      return boxes[1].left > boxes[0].left && boxes[2].left > boxes[1].left && boxes.every((box) => box.top === boxes[0].top)
    })
    .toBe(true)

  const runHistory = page.getByLabel('Selected node run history')
  await expect(runHistory.getByText('Run 1/3', { exact: true })).toBeVisible()
  await expect(runHistory.getByText('Run 2/3', { exact: true })).toBeVisible()
  await expect(runHistory.getByText('Run 3/3', { exact: true })).toBeVisible()
  await expect(runHistory.getByText('No ComfyUI prompt id')).toHaveCount(3)

  const previewButtons = canvas.getByRole('button', { name: 'View full result' })
  await expect(previewButtons).toHaveCount(3)
  await previewButtons.first().click()
  let previewDialog = page.getByRole('dialog', { name: `Preview ${testWorkflowName} Run 1.txt` })
  await expect(previewDialog.getByText('1 / 3')).toBeVisible()
  await previewDialog.getByRole('button', { name: 'Next result' }).click()
  previewDialog = page.getByRole('dialog', { name: `Preview ${testWorkflowName} Run 2.txt` })
  await expect(previewDialog.getByText(`Simulated ComfyUI result for ${testWorkflowName} run 2`)).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  previewDialog = page.getByRole('dialog', { name: `Preview ${testWorkflowName} Run 1.txt` })
  await expect(previewDialog.getByText(`Simulated ComfyUI result for ${testWorkflowName} run 1`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(previewDialog).toHaveCount(0)

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const minimapElement = document.querySelector('.comfy-minimap')
        const minimap = minimapElement?.getBoundingClientRect()
        const nodes = [...document.querySelectorAll('.react-flow__node')].map((node) =>
          node.getBoundingClientRect(),
        )
        if (!minimapElement || !minimap) return { hasOverlap: true, hasViewport: false, hasUsableViewport: false, hasAllNodes: false }
        const hasOverlap = nodes.some((node) => {
          const separated =
            node.right <= minimap.left ||
            node.left >= minimap.right ||
            node.bottom <= minimap.top ||
            node.top >= minimap.bottom
          return !separated
        })
        const viewport = minimapElement.querySelector('.comfy-minimap-viewport')
        const viewportWidth = Number.parseFloat(viewport?.getAttribute('width') ?? '0')
        const viewportHeight = Number.parseFloat(viewport?.getAttribute('height') ?? '0')
        return {
          hasOverlap,
          hasViewport: Boolean(viewport),
          hasUsableViewport: viewportWidth > 10 && viewportHeight > 10,
          hasAllNodes: minimapElement.querySelectorAll('.comfy-minimap-node').length === nodes.length,
        }
      }),
    )
    .toMatchObject({ hasOverlap: false, hasViewport: true, hasUsableViewport: true, hasAllNodes: true })

  await page.screenshot({ path: 'output/playwright/mvp-smoke.png', fullPage: true })
})

test.skip('collapses and expands both side panels without moving the page', async ({ page }) => {
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  const leftPanel = page.locator('.left-panel-shell')
  const rightPanel = page.locator('.right-panel-shell')
  const initial = await page.evaluate(() => ({
    canvasWidth: document.querySelector('.workspace-canvas')?.getBoundingClientRect().width ?? 0,
    bodyScrollable: document.documentElement.scrollHeight > window.innerHeight,
  }))

  await page.getByRole('button', { name: 'Collapse left panel' }).click()
  await expect(leftPanel).toHaveClass(/is-collapsed/)
  await expect(leftPanel.getByRole('heading', { name: 'Assets' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Expand left panel' })).toBeVisible()

  await expect
    .poll(async () => canvas.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(initial.canvasWidth)

  const afterLeft = await canvas.evaluate((element) => element.getBoundingClientRect().width)
  await page.getByRole('button', { name: 'Collapse right panel' }).click()
  await expect(rightPanel).toHaveClass(/is-collapsed/)
  await expect(rightPanel.getByRole('button', { name: 'ComfyUI Servers' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Expand right panel' })).toBeVisible()

  await expect
    .poll(async () => canvas.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(afterLeft)

  await page.getByRole('button', { name: 'Expand left panel' }).click()
  await page.getByRole('button', { name: 'Expand right panel' }).click()
  await expect(leftPanel).not.toHaveClass(/is-collapsed/)
  await expect(rightPanel).not.toHaveClass(/is-collapsed/)
  await expect(leftPanel.getByRole('heading', { name: 'Assets' })).toBeVisible()
  await expect(rightPanel.getByRole('button', { name: 'ComfyUI Servers' })).toBeVisible()
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        bodyScrollable: document.documentElement.scrollHeight > window.innerHeight,
      })),
    )
    .toEqual({ bodyScrollable: initial.bodyScrollable })
})

test.skip('manages projects from settings in a browser', async ({ page }) => {
  await page.goto('/')

  const dialog = await openSettings(page)
  await expect(dialog.getByLabel('Project name')).toHaveValue('Infinity ComfyUI Project')
  await dialog.getByLabel('Project name').fill('Browser Project A')
  await dialog.getByLabel('Project description').fill('Project switching smoke')

  await dialog.getByRole('button', { name: 'New project' }).click()
  await expect(dialog.getByLabel('Project name')).toHaveValue('Untitled Project')
  await dialog.getByLabel('Project name').fill('Browser Project B')

  await dialog.getByLabel('Active project').selectOption({ label: 'Browser Project A' })
  await expect(dialog.getByLabel('Project name')).toHaveValue('Browser Project A')
  await expect(dialog.getByLabel('Project description')).toHaveValue('Project switching smoke')

  page.once('dialog', async (confirmDialog) => {
    await confirmDialog.accept()
  })
  await dialog.getByRole('button', { name: 'Delete project' }).click()
  await expect(dialog.getByLabel('Project name')).toHaveValue('Browser Project B')
  await expect(dialog.getByLabel('Active project')).not.toContainText('Browser Project A')

  await closeSettings(page)
  await expect(page.getByText('Browser Project B')).toBeVisible()
})

test.skip('shows selected function workflow JSON as a single highlighted view', async ({ page }) => {
  await page.goto('/')

  await addTestWorkflow(page)
  const dialog = await openFunctionManagement(page)
  await dialog.getByLabel('Managed function list').getByRole('button', { name: testWorkflowName }).click()

  const selectedWorkflowJson = dialog.getByLabel('Selected workflow JSON')
  await expect(selectedWorkflowJson).toContainText('"Positive Prompt"')
  await expect(dialog.locator('.workflow-editor-grid textarea')).toHaveCount(0)
  await expect(dialog.locator('.selected-workflow-preview .json-key').first()).toBeVisible()

  await dialog.getByRole('button', { name: 'Format selected JSON' }).click()

  await expect(selectedWorkflowJson).toContainText('"class_type"')
  await expect(selectedWorkflowJson).toContainText('"Positive Prompt"')

  await dialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)
})

test.skip('creates and runs a request function from function management', async ({ page }) => {
  await page.route('https://api.example.com/request-smoke', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'hello from request function' }),
    })
  })
  await page.goto('/')

  const dialog = await openFunctionManagement(page)
  await dialog.getByRole('button', { name: 'Function', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: 'New Function' })
  await createDialog.getByLabel('Function type').selectOption('request')
  await createDialog.getByLabel('Function name').fill('Request Smoke')
  await createDialog.getByLabel('Request URL').fill('https://api.example.com/request-smoke')
  await createDialog.getByRole('button', { name: 'Save function' }).click()
  await expect(createDialog).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)

  await addFunctionNodeFromCanvasMenu(page, /Request Smoke/)
  await page.getByRole('button', { name: 'Run function' }).click()

  await expect(page.getByLabel('Run status succeeded')).toBeVisible()
  await expect(page.getByText(/hello from request function/).first()).toBeVisible()
})

test('creates a one-off request node and extracts media output from the canvas', async ({ page }) => {
  await page.route('https://api.example.com/one-off-media', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Disposition',
        'Content-Disposition': 'attachment; filename="result.png"',
      },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/akF7k0AAAAASUVORK5CYII=',
        'base64',
      ),
    })
  })
  await page.goto('/')

  const runner = await openBuiltInRunner(page, 'Request')
  await runner.getByLabel('Request URL').fill('https://api.example.com/one-off-media')
  await runner.getByLabel('Request response parse').selectOption('binary')
  await runner.getByRole('button', { name: 'Run function from popup' }).click()

  const canvas = page.locator('.workspace-canvas')
  const resultNode = canvas.locator('.react-flow__node-resource').filter({ hasText: 'result.png' }).first()
  await expect(resultNode).toBeVisible()
  await expect(resultNode.getByRole('img', { name: 'result.png' })).toBeVisible()
})

test.skip('runs local image tools from the selected resource context menu', async ({ page }) => {
  await page.goto('/')

  await addImageAssetByDrop(page)
  const canvas = page.locator('.workspace-canvas')
  const imageNode = canvas.locator('.react-flow__node-resource').filter({ hasText: 'tiny-local.png' })
  await imageNode.click()

  const quickActions = page.getByLabel('Resource quick actions')
  await expect(quickActions).toHaveCount(0)
  await imageNode.click({ button: 'right' })
  await expect(quickActions.getByRole('button', { name: 'Resize Image' })).toBeVisible()
  await expect(quickActions.getByRole('button', { name: 'Blur Image' })).toBeVisible()
  await expect(quickActions.getByRole('button', { name: 'Split Image Grid' })).toBeVisible()

  await quickActions.getByRole('button', { name: 'Resize Image' }).click()
  const dialog = page.getByRole('dialog', { name: 'Run Resize Image' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Scale').fill('0.5')
  await dialog.getByRole('button', { name: 'Run local function' }).click()
  await expect(dialog).toHaveCount(0)

  const resultNode = canvas.locator('.react-flow__node-result_group').first()
  await expect(resultNode).toContainText('Resize Image')
  await expect(resultNode.getByLabel('Run status succeeded')).toBeVisible()
  await expect(resultNode.getByText(/tiny-local-resize/).first()).toBeVisible()
  await expect(canvas.locator('[data-testid="result-resource-grid"] img')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge.result-edge')).toHaveCount(1)
})

test.skip('opens function editing actions from a function node context menu', async ({ page }) => {
  await page.goto('/')

  await addTestWorkflow(page)
  await addFunctionNodeFromCanvasMenu(page, testWorkflowName)

  const canvas = page.locator('.workspace-canvas')
  const functionNode = canvas.locator('.react-flow__node-function').filter({ hasText: testWorkflowName })
  await functionNode.click({ button: 'right' })

  const functionActions = page.getByLabel('Function node actions')
  await expect(functionActions.getByRole('button', { name: 'Edit This Node' })).toBeVisible()
  await expect(functionActions.getByRole('button', { name: 'Edit All Nodes' })).toBeVisible()

  await functionActions.getByRole('button', { name: 'Edit This Node' }).click()
  const dialog = page.getByRole('dialog', { name: 'Function Management' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Managed function list').getByRole('button')).toHaveCount(1)
  await expect(dialog.getByLabel('Function name')).toHaveValue(`${testWorkflowName} (this node)`)
  await dialog.getByRole('button', { name: 'Close Function Management' }).click()
})

test.skip('creates a custom OpenAI provider function from settings and adds it to the canvas', async ({ page }) => {
  await page.goto('/')

  const dialog = await openFunctionManagement(page)
  await dialog.getByRole('button', { name: 'Function', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: 'New Function' })
  await createDialog.getByLabel('Function type').selectOption('openai')
  await createDialog.getByLabel('Function name').fill('Browser OpenAI Provider')
  await createDialog.getByLabel('OpenAI base URL').fill('https://proxy.example.com/v1')
  await createDialog.getByLabel('OpenAI API key').fill('sk-browser')
  await createDialog.getByLabel('OpenAI model').fill('gpt-browser')
  await createDialog.getByRole('button', { name: 'Save function' }).click()
  await expect(createDialog).toHaveCount(0)
  await expect(dialog.getByLabel('OpenAI base URL')).toHaveValue('https://proxy.example.com/v1')
  await dialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)

  await addFunctionNodeFromCanvasMenu(page, /Browser OpenAI Provider/)
  await expect(page.locator('.workspace-canvas').getByText('Browser OpenAI Provider', { exact: true })).toBeVisible()
  await expect(page.getByLabel('OpenAI base URL')).toHaveValue('https://proxy.example.com/v1')
})

test('creates and runs the built-in OpenAI LLM runner with editable prompt', async ({ page }) => {
  await page.route('https://proxy.local/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    expect(route.request().headers().authorization).toBe('Bearer demo')
    expect(body).toMatchObject({
      model: 'gpt-4.1-mini',
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: [expect.objectContaining({ type: 'text', text: 'Return one line.' })],
        }),
      ]),
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'OpenAI text result' } }] }),
    })
  })
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  const runner = await openBuiltInRunner(page, 'OpenAI LLM')
  await runner.getByLabel('OpenAI base URL').fill('https://proxy.local/v1')
  await runner.getByLabel('OpenAI API key').fill('demo')
  await runner.getByRole('textbox', { name: 'OpenAI prompt' }).fill('Return one line.')
  await runner.getByRole('button', { name: 'Run function from popup' }).click()

  const resultNode = canvas.locator('.react-flow__node-resource').filter({ hasText: 'OpenAI text result' }).first()
  await expect(resultNode).toBeVisible()
  await expect(resultNode.getByRole('button', { name: 'Edit and run OpenAI LLM' })).toBeVisible()
})

test('shows OpenAI failures directly on the failed output asset', async ({ page }) => {
  await page.route('https://proxy.local/v1/chat/completions', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'text/plain',
      body: 'invalid api key',
    })
  })
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  const runner = await openBuiltInRunner(page, 'OpenAI LLM')
  await runner.getByLabel('OpenAI base URL').fill('https://proxy.local/v1')
  await runner.getByLabel('OpenAI API key').fill('demo')
  await runner.getByRole('button', { name: 'Run function from popup' }).click()

  const failedNode = canvas.locator('.react-flow__node-resource').filter({ hasText: 'Text' }).first()
  await expect(failedNode).toBeVisible()
  await expect(failedNode.getByLabel('Asset status failed')).toBeVisible()
  await expect(failedNode.getByRole('button', { name: 'Edit and run OpenAI LLM' })).toBeVisible()
})

test('reopens a failed built-in output asset as an editable runner', async ({ page }) => {
  let requestCount = 0
  await page.route('https://retry.local/v1/chat/completions', async (route) => {
    requestCount += 1
    if (requestCount === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'temporary provider error',
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: `Retry success ${requestCount}` } }] }),
    })
  })
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  const runner = await openBuiltInRunner(page, 'OpenAI LLM')
  await runner.getByLabel('OpenAI base URL').fill('https://retry.local/v1')
  await runner.getByLabel('OpenAI API key').fill('demo')
  await runner.getByRole('button', { name: 'Run function from popup' }).click()

  const failedNode = canvas.locator('.react-flow__node-resource').filter({ hasText: 'Text' }).first()
  await expect(failedNode.getByLabel('Asset status failed')).toBeVisible()

  await failedNode.getByRole('button', { name: 'Edit and run OpenAI LLM' }).click()
  const retryDialog = page.getByRole('dialog', { name: 'Run OpenAI LLM' })
  await expect(retryDialog.getByLabel('OpenAI base URL')).toHaveValue('https://retry.local/v1')
  await retryDialog.getByRole('button', { name: 'Run and replace current output' }).click()

  const successNode = canvas.locator('.react-flow__node-resource').filter({ hasText: 'Retry success 2' }).first()
  await expect(successNode).toBeVisible()
  await expect.poll(() => requestCount).toBe(2)
})

test('creates and runs the built-in Gemini LLM runner directly', async ({ page }) => {
  await page.route('https://gemini.local/v1beta/models/gemini-2.5-flash:generateContent', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    expect(route.request().headers()['x-goog-api-key']).toBe('gemini-browser-test')
    expect(body).toMatchObject({
      contents: [
        expect.objectContaining({
          role: 'user',
          parts: expect.arrayContaining([expect.objectContaining({ text: 'Return one line.' })]),
        }),
      ],
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Gemini text result' }] } }],
      }),
    })
  })
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  const runner = await openBuiltInRunner(page, 'Gemini LLM')
  await runner.getByLabel('Gemini base URL').fill('https://gemini.local/v1beta')
  await runner.getByLabel('Gemini API key').fill('gemini-browser-test')
  await runner.getByRole('textbox', { name: 'Gemini prompt' }).fill('Return one line.')
  await runner.getByRole('button', { name: 'Run function from popup' }).click()

  const resultNode = canvas.locator('.react-flow__node-resource').filter({ hasText: 'Gemini text result' }).first()
  await expect(resultNode).toBeVisible()
  await expect(resultNode.getByRole('button', { name: 'Edit and run Gemini LLM' })).toBeVisible()
})

test('creates and runs the built-in OpenAI and Gemini image runners directly', async ({ page }) => {
  await page.route('https://image.local/v1/images/generations', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    expect(route.request().headers().authorization).toBe('Bearer demo')
    expect(body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'generate a compact browser test image',
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { b64_json: 'aW1hZ2Ux', output_format: 'png' },
          { b64_json: 'aW1hZ2Uy', output_format: 'png' },
        ],
      }),
    })
  })
  await page.route('https://gemini-image.local/v1beta/models/gemini-3.1-flash-image-preview:generateContent', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    expect(route.request().headers()['x-goog-api-key']).toBe('gemini-image-browser-test')
    expect(body).toMatchObject({
      contents: [{ parts: [{ text: 'generate a compact gemini browser test image' }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
      },
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { mimeType: 'image/png', data: 'Z2VtaW5pMQ==' } },
                { inlineData: { mimeType: 'image/png', data: 'Z2VtaW5pMg==' } },
              ],
            },
          },
        ],
      }),
    })
  })

  await page.goto('/')
  const canvas = page.locator('.workspace-canvas')

  const openAiRunner = await openBuiltInRunner(page, 'OpenAI Image', { x: 480, y: 260 })
  await openAiRunner.getByLabel('OpenAI image base URL').fill('https://image.local/v1')
  await openAiRunner.getByLabel('OpenAI image API key').fill('demo')
  await openAiRunner.getByRole('textbox', { name: 'Manual input Prompt' }).fill('generate a compact browser test image')
  await openAiRunner.getByRole('button', { name: 'Run function from popup' }).click()

  const openAiImageOne = canvas.locator('.react-flow__node-resource').filter({ hasText: 'openai-image-1.png' }).first()
  const openAiImageTwo = canvas.locator('.react-flow__node-resource').filter({ hasText: 'openai-image-2.png' }).first()
  await expect(openAiImageOne.getByRole('img', { name: 'openai-image-1.png' })).toBeVisible()
  await expect(openAiImageTwo.getByRole('img', { name: 'openai-image-2.png' })).toBeVisible()
  await expect(openAiImageOne.getByRole('button', { name: 'Edit and run OpenAI Image' })).toBeVisible()
  await openAiImageOne.getByLabel('Open openai-image-1.png resource preview').focus()
  await page.keyboard.press('Enter')
  const openAiImagePreview = page.getByRole('dialog', { name: 'Preview openai-image-1.png' })
  await expect(openAiImagePreview.locator('img').first()).toBeVisible()
  await openAiImagePreview.getByRole('button', { name: 'Close full preview' }).click()

  const geminiRunner = await openBuiltInRunner(page, 'Gemini Image', { x: 820, y: 620 })
  await geminiRunner.getByLabel('Gemini image base URL').fill('https://gemini-image.local/v1beta')
  await geminiRunner.getByLabel('Gemini image API key').fill('gemini-image-browser-test')
  await geminiRunner.getByRole('textbox', { name: 'Manual input Prompt' }).fill('generate a compact gemini browser test image')
  await geminiRunner.getByRole('button', { name: 'Run function from popup' }).click()

  const geminiImageOne = canvas.locator('.react-flow__node-resource').filter({ hasText: 'gemini-image-1.png' }).first()
  const geminiImageTwo = canvas.locator('.react-flow__node-resource').filter({ hasText: 'gemini-image-2.png' }).first()
  await expect(geminiImageOne.getByRole('img', { name: 'gemini-image-1.png' })).toBeVisible()
  await expect(geminiImageTwo.getByRole('img', { name: 'gemini-image-2.png' })).toBeVisible()
  await expect(geminiImageOne.getByRole('button', { name: 'Edit and run Gemini Image' })).toBeVisible()
})

test.skip('opens the add-node menu from canvas double-click and unfinished connection drag', async ({ page }) => {
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 720, y: 360 } })
  await expect(page.getByRole('menu', { name: 'Add node' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await expect(canvas.getByText('Prompt', { exact: true })).toBeVisible()

  await addTestWorkflow(page)
  await addFunctionNodeFromCanvasMenu(page, testWorkflowName, { x: 1120, y: 360 })
  await expect(canvas.getByText(testWorkflowName, { exact: true })).toBeVisible()
  await page.waitForTimeout(250)
  const sourceHandle = page.locator('.react-flow__node-resource .react-flow__handle-right').first()
  const handleBox = await sourceHandle.boundingBox()
  if (!handleBox) throw new Error('source handle not found')

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + 520, handleBox.y + 260, { steps: 8 })
  await page.mouse.up()

  await expect(page.getByRole('menu', { name: 'Add node' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: testWorkflowName })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Function Node' })).toHaveCount(0)
})

test.skip('opens the add-node menu from handle clicks and places connected nodes beside the clicked node', async ({ page }) => {
  await page.goto('/')

  await addTestWorkflow(page)
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 220, y: 360 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  const resourceNode = page.locator('.react-flow__node-resource').first()
  const resourceBox = await resourceNode.boundingBox()
  if (!resourceBox) throw new Error('resource node not found')

  await resourceNode.locator('.react-flow__handle-right').click()
  await expect(page.getByRole('menu', { name: 'Add node' })).toBeVisible()
  await page.getByRole('menuitem', { name: testWorkflowName }).click()
  const functionNode = page.locator('.react-flow__node-function').filter({ hasText: testWorkflowName }).first()
  const functionBox = await functionNode.boundingBox()
  if (!functionBox) throw new Error('function node not created from output handle click')
  expect(Math.abs(functionBox.y - resourceBox.y)).toBeLessThanOrEqual(8)
  expect(functionBox.x).toBeGreaterThan(resourceBox.x + resourceBox.width + 70)
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)

  await functionNode.locator('[data-slot-handle="input:prompt"]').click()
  await expect(page.getByRole('menu', { name: 'Add node' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  const resourceNodes = page.locator('.react-flow__node-resource')
  const createdResourceNode = resourceNodes.nth(1)
  const createdResourceBox = await createdResourceNode.boundingBox()
  if (!createdResourceBox) throw new Error('resource node not created from input handle click')
  expect(Math.abs(createdResourceBox.y - functionBox.y)).toBeLessThanOrEqual(8)
  expect(createdResourceBox.x + createdResourceBox.width).toBeLessThan(functionBox.x - 70)
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
})

for (const viewportCase of [
  { name: 'desktop', viewport: { width: 2048, height: 1024 }, requiresInternalScroll: false },
  { name: 'narrow', viewport: { width: 320, height: 720 }, requiresInternalScroll: false },
  { name: 'short', viewport: { width: 900, height: 320 }, requiresInternalScroll: true },
]) {
  test(`keeps the add-node menu inside the viewport near canvas edges (${viewportCase.name})`, async ({ page }) => {
    await page.setViewportSize(viewportCase.viewport)
    await page.goto('/')

    const canvas = page.locator('.workspace-canvas')
    const canvasBox = await canvas.boundingBox()
    if (!canvasBox) throw new Error('canvas not found')

    await canvas.dblclick({
      position: {
        x: Math.max(10, canvasBox.width - 12),
        y: Math.max(10, canvasBox.height - 12),
      },
    })

    const menu = page.getByRole('menu', { name: 'Add node' })
    await expect(menu).toBeVisible()
    await menu.evaluate(
      () => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))),
    )

    const bounds = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        bottomInside: rect.bottom <= window.innerHeight - 8,
        leftInside: rect.left >= 8,
        rightInside: rect.right <= window.innerWidth - 8,
        topInside: rect.top >= 8,
      }
    })
    expect.soft(bounds).toEqual({
      bottomInside: true,
      leftInside: true,
      rightInside: true,
      topInside: true,
    })

    if (viewportCase.requiresInternalScroll) {
      const scrollMetrics = await menu.evaluate((element) => ({
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
      }))
      expect.soft(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
      expect.soft(['auto', 'scroll']).toContain(scrollMetrics.overflowY)

      await menu.hover({
        position: {
          x: Math.min(24, scrollMetrics.clientWidth / 2),
          y: Math.max(1, scrollMetrics.clientHeight - 16),
        },
      })
      await page.mouse.wheel(0, 1200)
      await page.waitForTimeout(100)
      expect.soft(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    }
  })
}

test.skip('filters the add-node menu with a focused keyword search', async ({ page }) => {
  await page.goto('/')
  const canvas = page.getByLabel('Canvas')
  await canvas.dblclick({ position: { x: 420, y: 260 } })

  const search = page.getByRole('searchbox', { name: 'Search nodes' })
  await expect(search).toBeFocused()
  await search.fill('open image')

  await expect(page.getByRole('menuitem', { name: 'OpenAI Generate Image' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Gemini Generate Image' })).not.toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Text Asset' })).not.toBeVisible()

  await search.fill('image asset')
  await expect(page.getByRole('menuitem', { name: 'Image Asset' })).toBeVisible()
})

test.skip('creates asset nodes from canvas menu and blank-canvas drops', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveCount(0)

  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 720, y: 360 } })
  await expect(page.getByRole('menuitem', { name: 'Text Asset' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Number Asset' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await expect(canvas.getByRole('textbox', { name: 'Prompt source' })).toHaveValue('')

  await canvas.dblclick({ position: { x: 760, y: 380 } })
  await page.getByRole('menuitem', { name: 'Number Asset' }).click()
  const numberInput = canvas.getByLabel('Number value')
  await expect(numberInput).toHaveValue('0')
  await numberInput.fill('42.5')
  await expect(numberInput).toHaveValue('42.5')
  await expect(page.getByLabel('Asset list')).toContainText('42.5')

  const textTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'Dropped text content')
    return transfer
  })
  await canvas.dispatchEvent('dragover', { clientX: 900, clientY: 420, dataTransfer: textTransfer })
  await canvas.dispatchEvent('drop', { clientX: 900, clientY: 420, dataTransfer: textTransfer })
  await expect
    .poll(async () => page.locator('textarea').evaluateAll((items) => items.map((item) => (item as HTMLTextAreaElement).value)))
    .toContain('Dropped text content')

  const fileTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['fake image'], 'drop.png', { type: 'image/png' }))
    return transfer
  })
  await canvas.dispatchEvent('dragover', { clientX: 960, clientY: 520, dataTransfer: fileTransfer })
  await canvas.dispatchEvent('drop', { clientX: 960, clientY: 520, dataTransfer: fileTransfer })
  await expect(canvas.getByRole('img', { name: 'drop.png' })).toBeVisible()
})

test.skip('edits optional primitive inputs inline and lets connections override them', async ({ page }) => {
  await page.goto('/')

  const workflowName = 'Optional Inline Workflow'
  const workflowWithOptionalText = {
    ...testComfyWorkflow,
    '7': {
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Negative Prompt' },
      inputs: {
        text: 'low quality',
      },
    },
  }

  const dialog = await openFunctionManagement(page)
  await createWorkflowFromFunctionManager(page, dialog, workflowName, workflowWithOptionalText)
  await dialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)

  await addFunctionNodeFromCanvasMenu(page, workflowName)
  const canvas = page.locator('.workspace-canvas')
  const functionNode = canvas.locator('.react-flow__node-function').filter({ hasText: workflowName })
  const inlineInput = functionNode.getByRole('textbox', { name: 'Negative Prompt inline value' })
  await expect(inlineInput).toHaveValue('low quality')
  await inlineInput.fill('avoid blur')
  await expect(inlineInput).toHaveValue('avoid blur')

  const optionalHandle = functionNode.locator('[data-slot-handle="input:negative_prompt"]')
  const optionalHandleBox = await optionalHandle.boundingBox()
  if (!optionalHandleBox) throw new Error('optional input handle not found')
  await page.mouse.move(optionalHandleBox.x + optionalHandleBox.width / 2, optionalHandleBox.y + optionalHandleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(optionalHandleBox.x - 160, optionalHandleBox.y + 90, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole('menu', { name: 'Add node' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await expect(canvas.getByRole('textbox', { name: 'Prompt source' }).last()).toHaveValue('avoid blur')
  await expect(functionNode.locator('[data-testid="function-input-slot-negative_prompt"]')).toContainText('avoid blur')
  await selectFirstInputEdge(page)
  await page.keyboard.press('Delete')
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(0)

  await canvas.dblclick({ position: { x: 180, y: 520 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await canvas.getByRole('textbox', { name: 'Prompt source' }).last().fill('connected negative prompt')

  const sourceHandle = page.locator('.react-flow__node-resource .react-flow__handle-right').last()
  const targetHandle = functionNode.locator('[data-slot-handle="input:negative_prompt"]')
  await expect(sourceHandle).toBeVisible()
  await expect(targetHandle).toBeVisible()
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('optional primitive handles not found')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect(functionNode.locator('[data-testid="function-input-slot-negative_prompt"]')).toContainText(
    'connected negative prompt',
  )
  await expect(functionNode.getByRole('textbox', { name: 'Negative Prompt inline value' })).toHaveCount(0)

  await selectFirstInputEdge(page)
  await page.keyboard.press('Delete')
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(0)
  await expect(functionNode.getByRole('textbox', { name: 'Negative Prompt inline value' })).toHaveValue('low quality')
})

test.skip('keeps manual resource-to-function connections visible after mouse up', async ({ page }) => {
  await page.goto('/')

  const functionDialog = await openFunctionManagement(page)
  await createWorkflowFromFunctionManager(page, functionDialog, testWorkflowName, testComfyWorkflow)
  await functionDialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)
  await addFunctionNodeFromCanvasMenu(page, testWorkflowName)
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 180, y: 500 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  const promptInput = page.getByRole('textbox', { name: 'Prompt source' })
  await promptInput.fill('中文，标点。！？manual connection prompt')
  await expect(promptInput).toHaveValue('中文，标点。！？manual connection prompt')
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(0)
  await page.waitForTimeout(250)

  const sourceHandle = page.locator('.react-flow__node-resource .react-flow__handle-right').first()
  const targetHandle = page.locator('.react-flow__node-function .react-flow__handle-left').first()
  await expect(sourceHandle).toBeVisible()
  await expect(targetHandle).toBeVisible()
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('connection handles not found')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
  await selectFirstInputEdge(page)
  await page.keyboard.press('Delete')
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(0)
  await page.keyboard.press('Control+Z')
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
})

test.skip('creates and connects an asset from a dangling function input without moving the viewport', async ({ page }) => {
  await page.goto('/')

  const functionDialog = await openFunctionManagement(page)
  await createWorkflowFromFunctionManager(page, functionDialog, testWorkflowName, testComfyWorkflow)
  await functionDialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)
  await addFunctionNodeFromCanvasMenu(page, testWorkflowName)

  const canvas = page.locator('.workspace-canvas')
  await expect(canvas.getByText(testWorkflowName, { exact: true })).toBeVisible()
  await page.waitForTimeout(250)

  const viewportTransform = await page
    .locator('.react-flow__viewport')
    .evaluate((element) => getComputedStyle(element).transform)
  const promptInputHandle = page.locator('.react-flow__node-function [data-slot-handle="input:prompt"]').first()
  const handleBox = await promptInputHandle.boundingBox()
  if (!handleBox) throw new Error('prompt input handle not found')

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x - 320, handleBox.y + 40, { steps: 10 })
  await page.mouse.up()

  await expect(page.getByRole('menu', { name: 'Add node' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()

  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge.input-edge').getByText('prompt', { exact: true })).toBeVisible()
  await expect
    .poll(async () =>
      page.locator('.react-flow__viewport').evaluate((element) => getComputedStyle(element).transform),
    )
    .toBe(viewportTransform)
})

test('pastes clipboard text as an asset and copies selected nodes without edges', async ({ page, browserName }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:7930' })
  await page.goto('/')
  await page.evaluate(() => navigator.clipboard.writeText('Clipboard prompt text'))

  const canvas = page.locator('.workspace-canvas')
  await canvas.click({ position: { x: 760, y: 360 } })
  await page.keyboard.press(browserName === 'webkit' ? 'Meta+V' : 'Control+V')
  await expect(canvas.getByRole('textbox', { name: 'Prompt source' })).toHaveValue('Clipboard prompt text')

  await page.locator('.react-flow__node-resource').first().click({ position: { x: 18, y: 18 } })
  await page.keyboard.press(browserName === 'webkit' ? 'Meta+C' : 'Control+C')
  await page.keyboard.press(browserName === 'webkit' ? 'Meta+V' : 'Control+V')

  await expect(page.locator('.react-flow__node-resource')).toHaveCount(2)
  await expect(page.locator('.react-flow__edge')).toHaveCount(0)
  await expect(page.locator('.react-flow__node-resource').filter({ hasText: 'Prompt Copy' })).toBeVisible()
})

test.skip('supports selected-node editing shortcuts', async ({ page, browserName }) => {
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  await createWorkflowGraph(page)
  await expect(canvas.getByText(testWorkflowName, { exact: true })).toBeVisible()

  const functionTitle = canvas.getByText(testWorkflowName, { exact: true })
  await functionTitle.click()
  await expect(page.getByRole('button', { name: 'Delete node' })).toBeVisible()

  await functionTitle.dblclick()
  const titleInput = page.getByLabel('Node title')
  await titleInput.fill('Render Node')
  await titleInput.press('Enter')
  await expect(canvas.getByText('Render Node', { exact: true })).toBeVisible()

  await page.keyboard.press(browserName === 'webkit' ? 'Meta+C' : 'Control+C')
  await page.keyboard.press(browserName === 'webkit' ? 'Meta+V' : 'Control+V')
  await expect(canvas.getByText('Render Node Copy', { exact: true })).toBeVisible()

  await page.keyboard.press('Delete')
  await expect(canvas.getByText('Render Node Copy', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+Z')
  await expect(canvas.getByText('Render Node Copy', { exact: true })).toBeVisible()

  await canvas.click({ position: { x: 900, y: 180 } })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Delete node' })).toHaveCount(0)

  await canvas.click({ button: 'right', position: { x: 620, y: 720 } })
  await expect(page.getByRole('menu', { name: 'Add node' })).toBeVisible()
})

test('supports ctrl-click node multi-select like shift-click', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  await addSelectableResourceNodes(page)

  const resourceNode = page.locator('.react-flow__node-resource').first()
  const secondResourceNode = page.locator('.react-flow__node-resource').last()
  await resourceNode.locator('.node-title').click()
  await expect(resourceNode).toHaveClass(/selected/)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

  await page.keyboard.down('Control')
  await secondResourceNode.locator('.node-title').click()
  await page.keyboard.up('Control')

  await expect(resourceNode).toHaveClass(/selected/)
  await expect(secondResourceNode).toHaveClass(/selected/)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await expect(canvas).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('deletes a selected image asset from its node delete button', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await page.goto('/')

  await addImageAssetByDrop(page)
  const imageNode = page.locator('.react-flow__node-resource').first()
  await imageNode.locator('.node-title').click()
  await expect(imageNode).toHaveClass(/selected/)

  await imageNode.getByRole('button', { name: 'Delete node' }).click()

  await expect(page.locator('.react-flow__node-resource')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('ctrl-drag box selection keeps the canvas rendered and selects enclosed nodes', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  await addSelectableResourceNodes(page)

  const resourceNode = page.locator('.react-flow__node-resource').first()
  const secondResourceNode = page.locator('.react-flow__node-resource').last()
  const resourceBox = await resourceNode.boundingBox()
  const secondResourceBox = await secondResourceNode.boundingBox()
  const canvasBox = await canvas.boundingBox()
  if (!resourceBox || !secondResourceBox || !canvasBox) throw new Error('nodes not found')

  await canvas.click({ position: { x: canvasBox.width - 40, y: 40 } })
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)

  const selectionStartX = Math.max(canvasBox.x + 16, Math.min(resourceBox.x, secondResourceBox.x) - 32)
  const selectionStartY = Math.max(canvasBox.y + 16, Math.min(resourceBox.y, secondResourceBox.y) - 32)
  const selectionEndX = Math.min(
    canvasBox.x + canvasBox.width - 16,
    Math.max(resourceBox.x + resourceBox.width, secondResourceBox.x + secondResourceBox.width) + 32,
  )
  const selectionEndY = Math.min(
    canvasBox.y + canvasBox.height - 16,
    Math.max(resourceBox.y + resourceBox.height, secondResourceBox.y + secondResourceBox.height) + 32,
  )

  await page.keyboard.down('Control')
  await page.mouse.move(selectionStartX, selectionStartY)
  await page.mouse.down()
  await page.mouse.move(selectionEndX, selectionEndY, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.up('Control')

  expect(pageErrors).toEqual([])
  await expect(canvas).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Infinity ComfyUI' })).toBeVisible()
  await expect(resourceNode).toHaveClass(/selected/)
  await expect(secondResourceNode).toHaveClass(/selected/)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await expect(page.locator('.react-flow__nodesselection-rect')).toBeHidden()
})

test.skip('supports ctrl box selection, shift add, alt remove, batch drag, and batch delete', async ({ page }) => {
  await page.goto('/')

  const canvas = page.locator('.workspace-canvas')
  await createWorkflowGraph(page)
  await expect(canvas.getByText(testWorkflowName, { exact: true })).toBeVisible()

  const resourceNode = page.locator('.react-flow__node-resource').first()
  const functionNode = page.locator('.react-flow__node-function').first()
  await resourceNode.locator('.node-title').click()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

  await page.keyboard.down('Shift')
  await functionNode.locator('.node-title').click()
  await page.keyboard.up('Shift')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)

  await page.keyboard.down('Alt')
  await functionNode.locator('.node-title').click()
  await page.keyboard.up('Alt')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

  const resourceBox = await resourceNode.boundingBox()
  const functionBox = await functionNode.boundingBox()
  const canvasBox = await canvas.boundingBox()
  if (!resourceBox || !functionBox || !canvasBox) throw new Error('nodes not found')

  await canvas.click({ position: { x: canvasBox.width - 40, y: 40 } })
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)

  const selectionStartX = Math.max(canvasBox.x + 16, Math.min(resourceBox.x, functionBox.x) - 32)
  const selectionStartY = Math.max(canvasBox.y + 16, Math.min(resourceBox.y, functionBox.y) - 32)
  const selectionEndX = Math.min(
    canvasBox.x + canvasBox.width - 16,
    Math.max(resourceBox.x + resourceBox.width, functionBox.x + functionBox.width) + 32,
  )
  const selectionEndY = Math.min(
    canvasBox.y + canvasBox.height - 16,
    Math.max(resourceBox.y + resourceBox.height, functionBox.y + functionBox.height) + 32,
  )

  await page.keyboard.down('Control')
  await page.mouse.move(selectionStartX, selectionStartY)
  await page.mouse.down()
  await page.mouse.move(selectionEndX, selectionEndY, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await expect(page.locator('.react-flow__nodesselection-rect')).toBeHidden()

  const beforeResource = await resourceNode.boundingBox()
  const beforeFunction = await functionNode.boundingBox()
  if (!beforeResource || !beforeFunction) throw new Error('selected nodes not found before drag')

  await page.mouse.move(beforeResource.x + beforeResource.width / 2, beforeResource.y + 24)
  await page.mouse.down()
  await page.mouse.move(beforeResource.x + beforeResource.width / 2 + 96, beforeResource.y + 72, { steps: 10 })
  await page.mouse.up()

  await expect
    .poll(async () => {
      const afterResource = await resourceNode.boundingBox()
      const afterFunction = await functionNode.boundingBox()
      return {
        resourceMoved: afterResource ? afterResource.x - beforeResource.x > 40 : false,
        functionMoved: afterFunction ? afterFunction.x - beforeFunction.x > 40 : false,
      }
    })
    .toEqual({ resourceMoved: true, functionMoved: true })

  await page.keyboard.press('Delete')
  await expect(page.locator('.react-flow__node-resource')).toHaveCount(0)
  await expect(page.locator('.react-flow__node-function')).toHaveCount(0)
})

test.skip('creates a compatible function from a dangling image connection and binds the image slot', async ({ page }) => {
  await page.goto('/')

  const imageEditWorkflow = {
    '9': { class_type: 'SaveImage', _meta: { title: 'Save Image' }, inputs: { images: ['75:65', 0] } },
    '76': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'reference.png' } },
    '75:74': {
      class_type: 'CLIPTextEncode',
      _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
      inputs: { text: 'edit the image' },
    },
  }

  const functionDialog = await openFunctionManagement(page)
  await createWorkflowFromFunctionManager(page, functionDialog, 'Image Edit', imageEditWorkflow)
  await functionDialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)

  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 120, y: 160 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await page.getByRole('textbox', { name: 'Prompt source' }).fill('existing prompt should stay unconnected')

  await canvas.dblclick({ position: { x: 220, y: 320 } })
  await page.getByRole('menuitem', { name: 'Image Asset' }).click()
  await expect(canvas.getByText('Image', { exact: true })).toBeVisible()
  await page.waitForTimeout(250)

  const imageNode = page.locator('.react-flow__node-resource').filter({ hasText: 'Image' }).last()
  const imageHandle = imageNode.locator('.react-flow__handle-right')
  const imageHandleBox = await imageHandle.boundingBox()
  if (!imageHandleBox) throw new Error('image handle not found')

  await page.mouse.move(imageHandleBox.x + imageHandleBox.width / 2, imageHandleBox.y + imageHandleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(imageHandleBox.x + 120, imageHandleBox.y + 40, { steps: 10 })
  await page.mouse.up()

  await expect(page.getByRole('menu', { name: 'Add node' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Image Edit' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: testWorkflowName })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Function Node' })).toHaveCount(0)

  await page.getByRole('menuitem', { name: 'Image Edit' }).click()

  await expect(canvas.getByText('Image Edit', { exact: true })).toBeVisible()
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge.input-edge').getByText('image', { exact: true })).toBeVisible()
  await expect(page.locator('.react-flow__edge.input-edge').getByText('prompt', { exact: true })).toHaveCount(0)
})

test('requires saving an endpoint URL before testing the persisted value', async ({ page }) => {
  await page.addInitScript(() => {
    type EndpointFetchAudit = {
      __expectedEndpointTestUrl?: string
      __testedEndpointUrls: string[]
      __unexpectedEndpointUrls: string[]
    }
    const originalFetch = window.fetch.bind(window)
    const audit = window as unknown as EndpointFetchAudit
    audit.__testedEndpointUrls = []
    audit.__unexpectedEndpointUrls = []
    window.fetch = async (...args) => {
      const input = args[0]
      const rawUrl = input instanceof Request ? input.url : String(input)
      const url = new URL(rawUrl, window.location.href)
      if (url.pathname.endsWith('/system_stats')) {
        const absoluteUrl = url.href
        audit.__testedEndpointUrls.push(absoluteUrl)
        if (absoluteUrl !== audit.__expectedEndpointTestUrl) {
          audit.__unexpectedEndpointUrls.push(absoluteUrl)
          throw new TypeError(`Unexpected endpoint test URL: ${absoluteUrl}`)
        }
        return new Response(JSON.stringify({ system: { comfyui_version: 'test' }, devices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return originalFetch(...args)
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Infinity ComfyUI' })).toBeVisible()
  const servers = await openComfyServerManagement(page)
  await servers.getByRole('button', { name: 'Edit server Local ComfyUI' }).click()
  let dialog = page.getByRole('dialog', { name: 'Edit ComfyUI Server' })
  const endpointUrl = dialog.getByLabel('Endpoint URL')
  const initialUrl = await endpointUrl.inputValue()
  const savedUrl = initialUrl === 'http://127.0.0.1:27707'
    ? 'http://127.0.0.1:27708'
    : 'http://127.0.0.1:27707'
  const expectedProxyUrl = await page.evaluate(
    (targetBase) => new URL(`/__comfy_proxy/${encodeURIComponent(targetBase)}/system_stats`, window.location.origin).href,
    savedUrl,
  )

  await page.evaluate((expectedUrl) => {
    const audit = window as unknown as {
      __expectedEndpointTestUrl: string
      __testedEndpointUrls: string[]
      __unexpectedEndpointUrls: string[]
    }
    audit.__expectedEndpointTestUrl = expectedUrl
    audit.__testedEndpointUrls = []
    audit.__unexpectedEndpointUrls = []
  }, expectedProxyUrl)
  await endpointUrl.fill(savedUrl)
  await expect(dialog.getByRole('button', { name: 'Test', exact: true })).toBeDisabled()
  await expect(dialog.getByText('Save before testing', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(() => {
      const audit = window as unknown as { __testedEndpointUrls: string[]; __unexpectedEndpointUrls: string[] }
      return { tested: audit.__testedEndpointUrls, unexpected: audit.__unexpectedEndpointUrls }
    }),
  ).toEqual({ tested: [], unexpected: [] })

  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await servers.getByRole('button', { name: 'Edit server Local ComfyUI' }).click()
  dialog = page.getByRole('dialog', { name: 'Edit ComfyUI Server' })
  await expect(dialog.getByLabel('Endpoint URL')).toHaveValue(savedUrl)
  const testButton = dialog.getByRole('button', { name: 'Test', exact: true })
  await expect(testButton).toBeEnabled()
  await expect(dialog.getByText('Save before testing', { exact: true })).toHaveCount(0)
  await testButton.click()

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __testedEndpointUrls: string[] }).__testedEndpointUrls))
    .toEqual([expectedProxyUrl])
  expect(
    await page.evaluate(() => (window as unknown as { __unexpectedEndpointUrls: string[] }).__unexpectedEndpointUrls),
  ).toEqual([])
  await expect
    .poll(async () =>
      dialog.locator('.endpoint-actions .status-dot').evaluate((element) => element.className),
    )
    .toContain('online')
})
