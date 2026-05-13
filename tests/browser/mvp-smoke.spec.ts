import { expect, test, type Page } from '@playwright/test'

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
  await openSettings(page)
  await page.getByRole('button', { name: 'ComfyUI Server Management' }).click()
  return page.getByRole('dialog', { name: 'ComfyUI Server Management' })
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
  await page.getByLabel('Prompt text').fill(text)
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

test('runs a canvas workflow in a browser', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Infinity ComfyUI' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run MVP' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByLabel('Function list')).toHaveCount(0)
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
  await expect(canvas.getByRole('spinbutton', { name: 'Run count' })).toHaveValue('3')
  await expect(canvas.getByRole('button', { name: 'Copy asset' }).first()).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Download asset' }).first()).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Copy result' })).toHaveCount(3)
  await expect(canvas.getByRole('button', { name: 'Download result' })).toHaveCount(3)
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge.result-edge')).toHaveCount(3)
  await expect(canvas.getByText(`Simulated ComfyUI result for ${testWorkflowName} run 1`)).toBeVisible()

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
  const runInspector = page.getByLabel('Run execution details')
  await expect(runInspector.getByRole('heading', { name: 'Run Details' })).toBeVisible()
  await expect(runInspector.getByRole('heading', { name: 'Inputs' })).toBeVisible()
  await expect(runInspector).toContainText('sunlit modern kitchen, realistic interior render')
  await expect(runInspector.getByRole('heading', { name: 'Final Workflow' })).toBeVisible()
  await expect(runInspector).toContainText('Positive Prompt')
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
  await previewDialog.getByRole('button', { name: 'Close full preview' }).click()

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const minimap = document.querySelector('.react-flow__minimap')?.getBoundingClientRect()
        const nodes = [...document.querySelectorAll('.react-flow__node')].map((node) =>
          node.getBoundingClientRect(),
        )
        if (!minimap) return { hasOverlap: false }
        const hasOverlap = nodes.some((node) => {
          const separated =
            node.right <= minimap.left ||
            node.left >= minimap.right ||
            node.bottom <= minimap.top ||
            node.top >= minimap.bottom
          return !separated
        })
        return { hasOverlap }
      }),
    )
    .toMatchObject({ hasOverlap: false })

  await page.screenshot({ path: 'output/playwright/mvp-smoke.png', fullPage: true })
})

test('collapses and expands both side panels without moving the page', async ({ page }) => {
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
  await expect(rightPanel.getByRole('heading', { name: 'Inspector' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Expand right panel' })).toBeVisible()

  await expect
    .poll(async () => canvas.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(afterLeft)

  await page.getByRole('button', { name: 'Expand left panel' }).click()
  await page.getByRole('button', { name: 'Expand right panel' }).click()
  await expect(leftPanel).not.toHaveClass(/is-collapsed/)
  await expect(rightPanel).not.toHaveClass(/is-collapsed/)
  await expect(leftPanel.getByRole('heading', { name: 'Assets' })).toBeVisible()
  await expect(rightPanel.getByRole('heading', { name: 'Inspector' })).toBeVisible()
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        bodyScrollable: document.documentElement.scrollHeight > window.innerHeight,
      })),
    )
    .toEqual({ bodyScrollable: initial.bodyScrollable })
})

test('manages projects from settings in a browser', async ({ page }) => {
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

test('edits selected function workflow JSON in the function manager', async ({ page }) => {
  await page.goto('/')

  await addTestWorkflow(page)
  const dialog = await openFunctionManagement(page)
  await dialog.getByLabel('Managed function list').getByRole('button', { name: testWorkflowName }).click()

  const selectedWorkflowJson = dialog.getByLabel('Selected workflow JSON')
  await expect(selectedWorkflowJson).toHaveValue(/Positive Prompt/)

  await selectedWorkflowJson.fill(
    '{"42":{"class_type":"SaveImage","_meta":{"title":"Edited Result"},"inputs":{"filename_prefix":"edited"}}}',
  )
  await dialog.getByRole('button', { name: 'Format selected JSON' }).click()

  await expect(selectedWorkflowJson).toHaveValue(/"class_type": "SaveImage"/)
  await expect(dialog.getByLabel('Selected workflow preview')).toContainText('"Edited Result"')

  await selectedWorkflowJson.fill('{"42":')
  await expect(selectedWorkflowJson).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByText(/Invalid workflow JSON/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)
})

test('creates and runs a request function from function management', async ({ page }) => {
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
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ image: 'https://cdn.example.com/result.png' }),
    })
  })
  await page.goto('/')

  await addFunctionNodeFromCanvasMenu(page, /^Request$/)
  await page.getByLabel('Request URL').fill('https://api.example.com/one-off-media')
  await page.getByLabel('Request output type result').selectOption('image')
  await page.getByLabel('Request output expression result').fill('$.image')
  await page.getByRole('button', { name: 'Run function' }).click()

  await expect(page.getByLabel('Run status succeeded')).toBeVisible()
  await expect(page.getByText('result.png').first()).toBeVisible()
})

test('creates a custom OpenAI provider function from settings and adds it to the canvas', async ({ page }) => {
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

test('creates and runs the built-in OpenAI LLM node with editable messages', async ({ page }) => {
  await page.route('https://proxy.local/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    expect(route.request().headers().authorization).toBe('Bearer demo')
    expect(body).toMatchObject({
      model: 'gpt-4.1-mini',
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
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

  await addFunctionNodeFromCanvasMenu(page, /OpenAI LLM/)

  const canvas = page.locator('.workspace-canvas')
  const openAiNode = canvas.locator('.openai-node')
  await expect(openAiNode.getByText('OpenAI LLM', { exact: true })).toBeVisible()
  await expect(openAiNode.locator('[data-testid^="function-input-slot-image_"]')).toHaveCount(6)
  await expect(openAiNode.locator('[data-testid="function-output-slot-text"]')).toBeVisible()

  await openAiNode.getByLabel('OpenAI base URL').fill('https://proxy.local/v1')
  await openAiNode.getByLabel('OpenAI API key').fill('demo')
  await openAiNode.getByRole('button', { name: 'Edit messages' }).click()
  const messageDialog = page.getByRole('dialog', { name: 'OpenAI Messages' })
  await messageDialog.getByLabel('OpenAI message role 1').selectOption('system')
  await messageDialog.getByLabel('OpenAI content 1.1').fill('Return one line.')
  await messageDialog.getByRole('button', { name: 'Close OpenAI Messages' }).click()
  await openAiNode.getByRole('button', { name: 'Run function' }).click()

  await expect(canvas.getByText('OpenAI text result')).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Copy result' })).toBeVisible()
})

test('shows OpenAI failures directly on the failed result node', async ({ page }) => {
  await page.route('https://proxy.local/v1/chat/completions', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'text/plain',
      body: 'invalid api key',
    })
  })
  await page.goto('/')

  await addFunctionNodeFromCanvasMenu(page, /OpenAI LLM/)
  const canvas = page.locator('.workspace-canvas')
  const openAiNode = canvas.locator('.openai-node')

  await openAiNode.getByLabel('OpenAI base URL').fill('https://proxy.local/v1')
  await openAiNode.getByLabel('OpenAI API key').fill('demo')
  await openAiNode.getByRole('button', { name: 'Run function' }).click()

  const failedNode = canvas.locator('.result-node-failed').first()
  await expect(failedNode).toBeVisible()
  await expect(failedNode).toContainText('OpenAI request failed: 401 invalid api key')
  await expect
    .poll(async () => failedNode.evaluate((element) => getComputedStyle(element).borderTopColor))
    .toBe('rgb(190, 18, 60)')
  await expect
    .poll(async () => {
      const functionBox = await openAiNode.boundingBox()
      const resultBox = await failedNode.boundingBox()
      if (!functionBox || !resultBox) return false
      return resultBox.x > functionBox.x + functionBox.width + 8
    })
    .toBe(true)
})

test('reruns failed result nodes in place and confirms before overwriting successful outputs', async ({ page }) => {
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

  await addFunctionNodeFromCanvasMenu(page, /OpenAI LLM/)
  const canvas = page.locator('.workspace-canvas')
  const openAiNode = canvas.locator('.openai-node')

  await openAiNode.getByLabel('OpenAI base URL').fill('https://retry.local/v1')
  await openAiNode.getByLabel('OpenAI API key').fill('demo')
  await openAiNode.getByRole('button', { name: 'Run function' }).click()

  const failedNode = canvas.locator('.result-node-failed').first()
  await expect(failedNode).toContainText('temporary provider error')
  await expect(canvas.locator('.react-flow__node-result_group')).toHaveCount(1)

  await failedNode.getByRole('button', { name: 'Rerun result' }).click()
  await expect(canvas.locator('.result-node-succeeded').first()).toContainText('Retry success 2')
  await expect(canvas.locator('.react-flow__node-result_group')).toHaveCount(1)

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('This run already succeeded. Rerun and overwrite its outputs?')
    await dialog.dismiss()
  })
  await canvas.locator('.result-node-succeeded').first().getByRole('button', { name: 'Rerun result' }).click()
  await expect.poll(() => requestCount).toBe(2)
})

test('creates and runs the built-in Gemini LLM node directly', async ({ page }) => {
  await page.route('https://gemini.local/v1beta/models/gemini-2.5-flash:generateContent', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    expect(route.request().headers()['x-goog-api-key']).toBe('gemini-browser-test')
    expect(body).toMatchObject({
      system_instruction: {
        parts: [expect.objectContaining({ text: 'Return one line.' })],
      },
      contents: [
        expect.objectContaining({
          role: 'user',
          parts: expect.arrayContaining([expect.objectContaining({ text: expect.any(String) })]),
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

  await addFunctionNodeFromCanvasMenu(page, /Gemini LLM/)

  const canvas = page.locator('.workspace-canvas')
  const geminiNode = canvas.locator('.gemini-node')
  await expect(geminiNode.getByText('Gemini LLM', { exact: true })).toBeVisible()
  await expect(geminiNode.locator('[data-testid^="function-input-slot-image_"]')).toHaveCount(6)
  await expect(geminiNode.locator('[data-testid="function-output-slot-text"]')).toBeVisible()

  await geminiNode.getByLabel('Gemini base URL').fill('https://gemini.local/v1beta')
  await geminiNode.getByLabel('Gemini API key').fill('gemini-browser-test')
  await geminiNode.getByRole('button', { name: 'Edit messages' }).click()
  const messageDialog = page.getByRole('dialog', { name: 'Gemini Messages' })
  await messageDialog.getByLabel('Gemini content 1.1').fill('Return one line.')
  await messageDialog.getByRole('button', { name: 'Close Gemini Messages' }).click()
  await geminiNode.getByRole('button', { name: 'Run function' }).click()

  await expect(canvas.getByText('Gemini text result')).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Copy result' })).toBeVisible()
})

test('creates and runs the built-in OpenAI and Gemini image nodes directly', async ({ page }) => {
  await page.route('https://image.local/v1/images/generations', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    expect(route.request().headers().authorization).toBe('Bearer demo')
    expect(body).toMatchObject({
      model: 'gpt-image-2',
      prompt: expect.any(String),
      size: '1024x1024',
      quality: 'high',
      output_format: 'webp',
      output_compression: 80,
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { b64_json: 'aW1hZ2Ux', output_format: 'webp' },
          { b64_json: 'aW1hZ2Uy', output_format: 'webp' },
        ],
      }),
    })
  })
  await page.route('https://gemini-image.local/v1beta/models/gemini-3.1-flash-image-preview:generateContent', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    expect(route.request().headers()['x-goog-api-key']).toBe('gemini-image-browser-test')
    expect(body).toMatchObject({
      contents: [{ parts: [{ text: expect.any(String) }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        responseFormat: { image: { aspectRatio: '16:9', imageSize: '2K' } },
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
  await canvas.dblclick({ position: { x: 160, y: 220 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await page.getByLabel('Prompt text').fill('existing prompt should not auto-connect')

  await addFunctionNodeFromCanvasMenu(page, /OpenAI Generate Image/)
  const openAiImageNode = canvas.locator('.image-generation-node').filter({ hasText: 'OpenAI Generate Image' })
  await expect(openAiImageNode.locator('[data-testid="function-input-slot-prompt"]')).toBeVisible()
  await expect(openAiImageNode.locator('[data-testid^="function-input-slot-image_"]')).toHaveCount(10)
  await expect(openAiImageNode.locator('[data-testid="function-output-slot-image"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(0)
  await openAiImageNode.getByLabel('OpenAI image base URL').fill('https://image.local/v1')
  await openAiImageNode.getByLabel('OpenAI image API key').fill('demo')
  await openAiImageNode.getByLabel('OpenAI image size').selectOption('1024x1024')
  await openAiImageNode.getByLabel('OpenAI image quality').selectOption('high')
  await openAiImageNode.getByLabel('OpenAI image output format').selectOption('webp')
  await openAiImageNode.getByLabel('OpenAI image output compression').fill('80')
  await openAiImageNode.getByRole('button', { name: 'Run function' }).click()
  await expect(openAiImageNode.locator('[data-testid="function-input-slot-prompt"]')).toHaveClass(/missing-slot/)
  await expect(openAiImageNode.locator('[data-testid="function-input-slot-prompt"]')).toContainText('Missing')
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(0)

  const textSourceHandle = page.locator('.react-flow__node-resource .react-flow__handle-right').first()
  const openAiPromptHandle = openAiImageNode.locator('[data-slot-handle="input:prompt"]')
  const textSourceBox = await textSourceHandle.boundingBox()
  const openAiPromptBox = await openAiPromptHandle.boundingBox()
  if (!textSourceBox || !openAiPromptBox) throw new Error('OpenAI image prompt connection handles not found')
  await page.mouse.move(textSourceBox.x + textSourceBox.width / 2, textSourceBox.y + textSourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(openAiPromptBox.x + openAiPromptBox.width / 2, openAiPromptBox.y + openAiPromptBox.height / 2, {
    steps: 10,
  })
  await page.mouse.up()
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
  await openAiImageNode.getByRole('button', { name: 'Run function' }).click()
  await expect(canvas.getByRole('img', { name: 'openai-image-1.webp' })).toBeVisible()
  await expect(canvas.getByRole('img', { name: 'openai-image-2.webp' })).toBeVisible()
  const firstOpenAiImageResult = canvas.locator('.react-flow__node-result_group').filter({ hasText: 'openai-image-1.webp' }).first()
  await firstOpenAiImageResult.evaluate((element) => {
    ;(element as HTMLElement).style.width = '700px'
    ;(element as HTMLElement).style.height = '420px'
  })
  await expect
    .poll(async () =>
      firstOpenAiImageResult.evaluate((element) => {
        const node = element.getBoundingClientRect()
        const card = element.querySelector('.result-preview-card')?.getBoundingClientRect()
        const media = element.querySelector('.result-preview-card img, .result-preview-card video')?.getBoundingClientRect()
        if (!card || !media) return false
        return card.bottom <= node.bottom + 1 && media.bottom <= node.bottom + 1 && media.right <= node.right + 1
      }),
    )
    .toBe(true)
  await firstOpenAiImageResult.evaluate((element) => {
    ;(element as HTMLElement).style.width = ''
    ;(element as HTMLElement).style.height = ''
  })
  await canvas
    .locator('.result-preview-card')
    .filter({ hasText: 'openai-image-1.webp' })
    .getByRole('button', { name: 'View full result' })
    .click()
  const openAiImagePreview = page.getByRole('dialog', { name: 'Preview openai-image-1.webp' })
  await expect(openAiImagePreview.getByRole('img', { name: 'openai-image-1.webp' })).toBeVisible()
  await openAiImagePreview.getByRole('button', { name: 'Close full preview' }).click()

  await openAiImageNode.getByRole('button', { name: 'Run function' }).click()
  const openAiResultNodes = page.locator('.react-flow__node-result_group').filter({ hasText: 'openai-image-1.webp' })
  await expect(openAiResultNodes).toHaveCount(2)
  await openAiResultNodes.nth(0).click({ position: { x: 24, y: 24 } })
  await openAiResultNodes.nth(1).click({ modifiers: ['Shift'], position: { x: 24, y: 24 } })
  await expect(page.getByRole('button', { name: 'Compare selected runs' })).toBeVisible()
  await page.getByRole('button', { name: 'Compare selected runs' }).click()
  const compareDialog = page.getByRole('dialog', { name: 'Compare run results' })
  await expect(compareDialog).toBeVisible()
  const compareSlider = compareDialog.getByRole('slider', { name: 'Image comparison slider' })
  await expect(compareSlider).toHaveAttribute('aria-valuenow', '50')
  const sliderBox = await compareSlider.boundingBox()
  if (!sliderBox) throw new Error('comparison slider not found')
  await page.mouse.move(sliderBox.x + sliderBox.width * 0.75, sliderBox.y + sliderBox.height / 2)
  await expect(compareSlider).toHaveAttribute('aria-valuenow', '75')
  await page.keyboard.press('ArrowLeft')
  await expect(compareSlider).toHaveAttribute('aria-valuenow', '73')
  await compareDialog.getByRole('button', { name: 'Close comparison' }).click()

  await addFunctionNodeFromCanvasMenu(page, /Gemini Generate Image/, { x: 720, y: 620 })
  const geminiImageNode = canvas.locator('.image-generation-node').filter({ hasText: 'Gemini Generate Image' })
  await expect(geminiImageNode.locator('[data-testid="function-input-slot-prompt"]')).toBeVisible()
  await expect(geminiImageNode.locator('[data-testid^="function-input-slot-image_"]')).toHaveCount(10)
  await expect(geminiImageNode.locator('[data-testid="function-output-slot-image"]')).toBeVisible()
  await expect.poll(async () => (await geminiImageNode.locator('.node-slots').boundingBox())?.height ?? 0).toBeLessThan(320)
  await expect.poll(async () => (await geminiImageNode.boundingBox())?.height ?? 0).toBeLessThan(760)
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(1)
  await geminiImageNode.getByLabel('Gemini image base URL').fill('https://gemini-image.local/v1beta')
  await geminiImageNode.getByLabel('Gemini image API key').fill('gemini-image-browser-test')
  await geminiImageNode.getByLabel('Gemini image aspect ratio').selectOption('16:9')
  await geminiImageNode.getByLabel('Gemini image size').selectOption('2K')
  await geminiImageNode.getByRole('button', { name: 'Run function' }).click()
  await expect(geminiImageNode.locator('[data-testid="function-input-slot-prompt"]')).toHaveClass(/missing-slot/)

  const geminiPromptHandle = geminiImageNode.locator('[data-slot-handle="input:prompt"]')
  const textSourceBoxForGemini = await textSourceHandle.boundingBox()
  const geminiPromptBox = await geminiPromptHandle.boundingBox()
  if (!textSourceBoxForGemini || !geminiPromptBox) throw new Error('Gemini image prompt connection handles not found')
  await page.mouse.move(
    textSourceBoxForGemini.x + textSourceBoxForGemini.width / 2,
    textSourceBoxForGemini.y + textSourceBoxForGemini.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(geminiPromptBox.x + geminiPromptBox.width / 2, geminiPromptBox.y + geminiPromptBox.height / 2, {
    steps: 10,
  })
  await page.mouse.up()
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(2)
  await geminiImageNode.getByRole('button', { name: 'Run function' }).click()
  await expect(canvas.getByRole('img', { name: 'gemini-image-1.png' })).toBeVisible()
  await expect(canvas.getByRole('img', { name: 'gemini-image-2.png' })).toBeVisible()
})

test('opens the add-node menu from canvas double-click and unfinished connection drag', async ({ page }) => {
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

test('keeps the add-node menu inside the viewport near canvas edges', async ({ page }) => {
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

  await expect
    .poll(async () =>
      menu.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          bottomInside: rect.bottom <= window.innerHeight - 8,
          leftInside: rect.left >= 8,
          rightInside: rect.right <= window.innerWidth - 8,
          topInside: rect.top >= 8,
        }
      }),
    )
    .toEqual({
      bottomInside: true,
      leftInside: true,
      rightInside: true,
      topInside: true,
    })
})

test('filters the add-node menu with a focused keyword search', async ({ page }) => {
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

test('creates asset nodes from canvas menu and blank-canvas drops', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveCount(0)

  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 720, y: 360 } })
  await expect(page.getByRole('menuitem', { name: 'Text Asset' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Number Asset' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await expect(canvas.getByLabel('Prompt text')).toHaveValue('')

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

test('edits optional primitive inputs inline and lets connections override them', async ({ page }) => {
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
  await expect(canvas.getByLabel('Prompt text').last()).toHaveValue('avoid blur')
  await expect(functionNode.locator('[data-testid="function-input-slot-negative_prompt"]')).toContainText('avoid blur')
  await selectFirstInputEdge(page)
  await page.keyboard.press('Delete')
  await expect(page.locator('.react-flow__edge.input-edge')).toHaveCount(0)

  await canvas.dblclick({ position: { x: 180, y: 520 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  await canvas.getByLabel('Prompt text').last().fill('connected negative prompt')

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

test('keeps manual resource-to-function connections visible after mouse up', async ({ page }) => {
  await page.goto('/')

  const functionDialog = await openFunctionManagement(page)
  await createWorkflowFromFunctionManager(page, functionDialog, testWorkflowName, testComfyWorkflow)
  await functionDialog.getByRole('button', { name: 'Close Function Management' }).click()
  await closeSettings(page)
  await addFunctionNodeFromCanvasMenu(page, testWorkflowName)
  const canvas = page.locator('.workspace-canvas')
  await canvas.dblclick({ position: { x: 180, y: 500 } })
  await page.getByRole('menuitem', { name: 'Text Asset' }).click()
  const promptInput = page.getByLabel('Prompt text')
  await promptInput.click()
  await page.keyboard.insertText('中文，标点。！？manual connection prompt')
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

test('creates and connects an asset from a dangling function input without moving the viewport', async ({ page }) => {
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
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5173' })
  await page.goto('/')
  await page.evaluate(() => navigator.clipboard.writeText('Clipboard prompt text'))

  const canvas = page.locator('.workspace-canvas')
  await canvas.click({ position: { x: 760, y: 360 } })
  await page.keyboard.press(browserName === 'webkit' ? 'Meta+V' : 'Control+V')
  await expect(canvas.getByLabel('Prompt text')).toHaveValue('Clipboard prompt text')

  await page.locator('.react-flow__node-resource').first().click({ position: { x: 18, y: 18 } })
  await page.keyboard.press(browserName === 'webkit' ? 'Meta+C' : 'Control+C')
  await page.keyboard.press(browserName === 'webkit' ? 'Meta+V' : 'Control+V')

  await expect(page.locator('.react-flow__node-resource')).toHaveCount(2)
  await expect(page.locator('.react-flow__edge')).toHaveCount(0)
  await expect(page.locator('.react-flow__node-resource').filter({ hasText: 'Prompt Copy' })).toBeVisible()
})

test('supports selected-node editing shortcuts', async ({ page, browserName }) => {
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

test('supports ctrl box selection, shift add, alt remove, batch drag, and batch delete', async ({ page }) => {
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
  if (!resourceBox || !functionBox) throw new Error('nodes not found')

  await page.keyboard.down('Control')
  await page.mouse.move(Math.min(resourceBox.x, functionBox.x) - 24, Math.min(resourceBox.y, functionBox.y) - 24)
  await page.mouse.down()
  await page.mouse.move(
    Math.max(resourceBox.x + resourceBox.width, functionBox.x + functionBox.width) + 24,
    Math.max(resourceBox.y + resourceBox.height, functionBox.y + functionBox.height) + 24,
    { steps: 10 },
  )
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

test('creates a compatible function from a dangling image connection and binds the image slot', async ({ page }) => {
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
  await page.getByLabel('Prompt text').fill('existing prompt should stay unconnected')

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

test('tests the current endpoint input value after a fast edit', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    ;(window as unknown as { __testedEndpointUrls: string[] }).__testedEndpointUrls = []
    window.fetch = async (...args) => {
      const url = String(args[0])
      if (url.endsWith('/system_stats')) {
        ;(window as unknown as { __testedEndpointUrls: string[] }).__testedEndpointUrls.push(url)
        if (url === 'http://127.0.0.1:27707/system_stats') {
          return new Response(JSON.stringify({ system: { comfyui_version: 'test' }, devices: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new TypeError(`Unexpected endpoint URL: ${url}`)
      }

      return originalFetch(...args)
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Infinity ComfyUI' })).toBeVisible()
  const dialog = await openComfyServerManagement(page)
  await dialog.getByLabel('Endpoint URL Local ComfyUI').fill('http://127.0.0.1:27707')
  await dialog.locator('.endpoint-manager-row').getByRole('button', { name: 'Test' }).click()

  await expect
    .poll(async () =>
      page.evaluate(() => (window as unknown as { __testedEndpointUrls: string[] }).__testedEndpointUrls.join('\n')),
    )
    .toContain('http://127.0.0.1:27707/system_stats')
  await expect
    .poll(async () =>
      dialog.locator('.endpoint-manager-row .status-dot').evaluate((element) => element.className),
    )
    .toContain('online')
})
