/**
 * Testes de integração da API REST.
 * Requer backend rodando em http://localhost:3000
 * Execute: node --test --require tsx/esm src/test/api.test.ts
 */
import { strict as assert } from 'node:assert'
import { test, describe, before, after } from 'node:test'

const BASE = process.env.API_URL ?? 'http://localhost:3000'

let authCookie = ''
let campaignId = ''
let variationId = ''
let numberId = ''

async function api(method: string, path: string, body?: any, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = res.status === 204 ? null : await res.json()
  return { status: res.status, data, headers: res.headers }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  const testEmail = `test_${Date.now()}@rcs.test`
  const testPassword = 'testPassword123'

  test('registra nova org e usuário admin', async () => {
    const { status, data, headers } = await api('POST', '/api/auth/register', {
      orgName: `Test Org ${Date.now()}`,
      email: testEmail,
      password: testPassword,
    })
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(data.user.id)
    assert.equal(data.user.role, 'admin')
    assert.ok(data.user.orgId)

    const setCookie = headers.get('set-cookie')
    assert.ok(setCookie, 'should set auth cookie')
    authCookie = setCookie!.split(';')[0]
  })

  test('rejeita email duplicado', async () => {
    const { status } = await api('POST', '/api/auth/register', {
      orgName: 'Outra Org',
      email: testEmail,
      password: testPassword,
    })
    assert.equal(status, 409)
  })

  test('login com credenciais válidas', async () => {
    const { status, data, headers } = await api('POST', '/api/auth/login', {
      email: testEmail,
      password: testPassword,
    })
    assert.equal(status, 200)
    assert.ok(data.user.id)
    const setCookie = headers.get('set-cookie')
    assert.ok(setCookie)
    authCookie = setCookie!.split(';')[0]
  })

  test('rejeita credenciais inválidas', async () => {
    const { status } = await api('POST', '/api/auth/login', {
      email: testEmail,
      password: 'senhaErrada',
    })
    assert.equal(status, 401)
  })

  test('GET /me retorna usuário autenticado', async () => {
    const { status, data } = await api('GET', '/api/auth/me', undefined, authCookie)
    assert.equal(status, 200)
    assert.equal(data.user.email, testEmail)
  })

  test('GET /me retorna 401 sem cookie', async () => {
    const { status } = await api('GET', '/api/auth/me')
    assert.equal(status, 401)
  })
})

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

describe('Campaigns', () => {
  test('cria campanha', async () => {
    const { status, data } = await api('POST', '/api/campaigns', {
      name: 'Campanha de Teste',
    }, authCookie)
    assert.equal(status, 201, JSON.stringify(data))
    assert.equal(data.name, 'Campanha de Teste')
    assert.equal(data.status, 'draft')
    assert.ok(data.id)
    campaignId = data.id
  })

  test('lista campanhas', async () => {
    const { status, data } = await api('GET', '/api/campaigns', undefined, authCookie)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data))
    assert.ok(data.length >= 1)
  })

  test('busca campanha por id', async () => {
    const { status, data } = await api('GET', `/api/campaigns/${campaignId}`, undefined, authCookie)
    assert.equal(status, 200)
    assert.equal(data.id, campaignId)
  })

  test('atualiza campanha', async () => {
    const { status, data } = await api('PATCH', `/api/campaigns/${campaignId}`, {
      intervalMinSeconds: 45,
      intervalMaxSeconds: 150,
    }, authCookie)
    assert.equal(status, 200)
    assert.equal(data.intervalMinSeconds, 45)
    assert.equal(data.intervalMaxSeconds, 150)
  })

  test('retorna 404 para campanha inexistente', async () => {
    const { status } = await api('GET', '/api/campaigns/00000000-0000-0000-0000-000000000000', undefined, authCookie)
    assert.equal(status, 404)
  })
})

// ── VARIATIONS ────────────────────────────────────────────────────────────────

describe('Message Variations', () => {
  test('cria variação', async () => {
    const { status, data } = await api('POST', `/api/campaigns/${campaignId}/variations`, {
      body: 'Olá, {{nome}}! Temos uma promoção especial para você.',
    }, authCookie)
    assert.equal(status, 201, JSON.stringify(data))
    assert.ok(data.id)
    assert.equal(data.body, 'Olá, {{nome}}! Temos uma promoção especial para você.')
    variationId = data.id
  })

  test('lista variações', async () => {
    const { status, data } = await api('GET', `/api/campaigns/${campaignId}/variations`, undefined, authCookie)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data))
    assert.equal(data.length, 1)
  })

  test('atualiza variação', async () => {
    const { status, data } = await api('PATCH', `/api/campaigns/${campaignId}/variations/${variationId}`, {
      body: 'Olá, {{nome}}! Mensagem atualizada.',
    }, authCookie)
    assert.equal(status, 200)
    assert.equal(data.body, 'Olá, {{nome}}! Mensagem atualizada.')
  })

  test('rejeita mais de 5 variações', async () => {
    for (let i = 0; i < 4; i++) {
      await api('POST', `/api/campaigns/${campaignId}/variations`, {
        body: `Variação extra ${i}`,
      }, authCookie)
    }
    const { status } = await api('POST', `/api/campaigns/${campaignId}/variations`, {
      body: 'Sexta variação — deve falhar',
    }, authCookie)
    assert.equal(status, 422)
  })
})

// ── CONTACTS ─────────────────────────────────────────────────────────────────

describe('Contacts', () => {
  test('adiciona contato manualmente', async () => {
    const { status, data } = await api('POST', `/api/campaigns/${campaignId}/contacts`, {
      name: 'João Teste',
      phone: '48999990001',
    }, authCookie)
    assert.equal(status, 201, JSON.stringify(data))
    assert.equal(data.phone, '+5548999990001') // normalizado
    assert.equal(data.status, 'pending')
  })

  test('rejeita telefone inválido', async () => {
    const { status, data } = await api('POST', `/api/campaigns/${campaignId}/contacts`, {
      name: 'Inválido',
      phone: '123',
    }, authCookie)
    assert.equal(status, 400, JSON.stringify(data))
  })

  test('lista contatos', async () => {
    const { status, data } = await api('GET', `/api/campaigns/${campaignId}/contacts`, undefined, authCookie)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.data))
    assert.ok(data.total >= 1)
  })

  test('deduplicação: mesmo telefone não entra duas vezes', async () => {
    const { status } = await api('POST', `/api/campaigns/${campaignId}/contacts`, {
      name: 'João Duplicado',
      phone: '48999990001', // mesmo do teste anterior
    }, authCookie)
    assert.equal(status, 409)
  })
})

// ── NUMBERS ──────────────────────────────────────────────────────────────────

describe('Numbers', () => {
  test('cria número', async () => {
    const { status, data } = await api('POST', '/api/numbers', {
      name: 'Número de Teste',
      phoneLabel: '+5548888880001',
    }, authCookie)
    assert.equal(status, 201, JSON.stringify(data))
    assert.equal(data.name, 'Número de Teste')
    assert.equal(data.status, 'pending_auth')
    numberId = data.id
  })

  test('lista números', async () => {
    const { status, data } = await api('GET', '/api/numbers', undefined, authCookie)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data))
    assert.ok(data.length >= 1)
  })

  test('retorna status do número', async () => {
    const { status, data } = await api('GET', `/api/numbers/${numberId}/status`, undefined, authCookie)
    assert.equal(status, 200)
    assert.equal(data.id, numberId)
    assert.ok(['pending_auth', 'authenticated', 'disconnected'].includes(data.status))
  })
})

// ── HEALTH ────────────────────────────────────────────────────────────────────

describe('Health', () => {
  test('GET /health retorna ok', async () => {
    const { status, data } = await api('GET', '/health')
    assert.equal(status, 200)
    assert.equal(data.ok, true)
  })
})

// ── CLEANUP ───────────────────────────────────────────────────────────────────

describe('Cleanup', () => {
  test('deleta número criado no teste', async () => {
    if (!numberId) return
    const { status } = await api('DELETE', `/api/numbers/${numberId}`, undefined, authCookie)
    assert.ok([204, 404].includes(status))
  })
})
