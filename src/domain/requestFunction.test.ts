import { describe, expect, it } from 'vitest'
import type { FunctionOutputDef, Resource } from './types'
import {
  compileRequestFunctionRequest,
  createRequestFunction,
  extractRequestFunctionOutputs,
  requestOutputSourcesForParse,
  requestOutputTypesForParse,
} from './requestFunction'

describe('request function helpers', () => {
  it('creates a configurable HTTP request function', () => {
    const fn = createRequestFunction('fn_request', 'Webhook Lookup', '2026-05-13T00:00:00.000Z')

    expect(fn.workflow.format).toBe('http_request')
    expect(fn.request).toMatchObject({
      url: 'https://example.com/api',
      method: 'GET',
      headers: {},
      body: '',
      responseParse: 'json',
      responseEncoding: 'utf-8',
    })
    expect(fn.outputs).toEqual([
      expect.objectContaining({
        key: 'result',
        label: 'Result',
        type: 'text',
        extract: expect.objectContaining({ source: 'response_json_path', path: '$' }),
      }),
    ])
  })

  it('applies input values to URL params, headers, and JSON body fields', () => {
    const fn = createRequestFunction('fn_request', 'Webhook Lookup', '2026-05-13T00:00:00.000Z')
    fn.request = {
      url: 'https://api.example.com/search?existing=1',
      method: 'POST',
      headers: { 'X-Static': 'ok' },
      body: '{"prompt":"old","nested":{"count":1}}',
      responseParse: 'json',
      responseEncoding: 'gbk',
    }
    fn.inputs = [
      {
        key: 'query',
        label: 'Query',
        type: 'text',
        required: true,
        bind: { path: 'q', requestTarget: 'url_param' },
        upload: { strategy: 'none' },
      },
      {
        key: 'auth',
        label: 'Authorization',
        type: 'text',
        required: true,
        bind: { path: 'Authorization', requestTarget: 'header' },
        upload: { strategy: 'none' },
      },
      {
        key: 'count',
        label: 'Count',
        type: 'number',
        required: false,
        bind: { path: '$.nested.count', requestTarget: 'body' },
        upload: { strategy: 'none' },
      },
    ]

    const request = compileRequestFunctionRequest(
      fn,
      { query: 'kitchen render', auth: 'Bearer token', count: 3 },
      {},
    )

    expect(request.url).toBe('https://api.example.com/search?existing=1&q=kitchen+render')
    expect(request.init.method).toBe('POST')
    expect(request.init.headers).toMatchObject({ 'X-Static': 'ok', Authorization: 'Bearer token' })
    expect(request.init.body).toBe('{"prompt":"old","nested":{"count":3}}')
    expect(request.responseEncoding).toBe('gbk')
  })

  it('limits request output sources and types by response parser', () => {
    expect(requestOutputSourcesForParse('json')).toEqual(['response_json_path', 'response_text_regex'])
    expect(requestOutputSourcesForParse('text')).toEqual(['response_text_regex'])
    expect(requestOutputSourcesForParse('binary')).toEqual(['response_binary'])

    expect(requestOutputTypesForParse('json')).toEqual(['text', 'number'])
    expect(requestOutputTypesForParse('text')).toEqual(['text', 'number'])
    expect(requestOutputTypesForParse('binary')).toEqual(['image', 'video', 'audio'])
  })

  it('extracts text outputs with regex and JSON path selectors', () => {
    const outputs: FunctionOutputDef[] = [
      {
        key: 'title',
        label: 'Title',
        type: 'text',
        bind: {},
        extract: { source: 'response_text_regex', pattern: 'title: (.+)' },
      },
      {
        key: 'first_image',
        label: 'First Image',
        type: 'image',
        bind: {},
        extract: { source: 'response_json_path', path: '$.images[0].url' },
      },
    ]
    const responseJson = {
      images: [{ url: 'https://cdn.example.com/render.png' }],
    }

    expect(extractRequestFunctionOutputs('title: Sunny kitchen', responseJson, outputs)).toEqual([
      { key: 'title', label: 'Title', type: 'text', values: ['Sunny kitchen'] },
      { key: 'first_image', label: 'First Image', type: 'image', values: ['https://cdn.example.com/render.png'] },
    ])
  })

  it('reads primitive values from linked resources before compiling the request', () => {
    const fn = createRequestFunction('fn_request', 'Webhook Lookup', '2026-05-13T00:00:00.000Z')
    fn.request = {
      url: 'https://api.example.com/search',
      method: 'GET',
      headers: {},
      body: '',
      responseParse: 'text',
      responseEncoding: 'utf-8',
    }
    fn.inputs = [
      {
        key: 'q',
        label: 'Query',
        type: 'text',
        required: true,
        bind: { path: 'q', requestTarget: 'url_param' },
        upload: { strategy: 'none' },
      },
    ]
    const resources: Record<string, Resource> = {
      res_prompt: {
        id: 'res_prompt',
        type: 'text',
        name: 'Prompt',
        value: 'from resource',
        source: { kind: 'manual_input' },
        metadata: { createdAt: '2026-05-13T00:00:00.000Z' },
      },
    }

    const request = compileRequestFunctionRequest(fn, { q: { resourceId: 'res_prompt', type: 'text' } }, resources)

    expect(request.url).toBe('https://api.example.com/search?q=from+resource')
  })
})
