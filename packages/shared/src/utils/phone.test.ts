import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'
import { normalizePhone, isValidPhone, canonicalPhone } from './phone'

describe('normalizePhone', () => {
  test('aceita formato E.164 completo', () => {
    assert.equal(normalizePhone('+5548999990001'), '+5548999990001')
  })

  test('adiciona +55 para número de 11 dígitos (com DDD)', () => {
    assert.equal(normalizePhone('48999990001'), '+5548999990001')
  })

  test('adiciona +55 para número com 55 no início sem +', () => {
    assert.equal(normalizePhone('5548999990001'), '+5548999990001')
  })

  test('normaliza número com formatação brasileira', () => {
    const result = normalizePhone('(48) 99999-0001')
    assert.equal(result, '+5548999990001')
  })

  test('retorna null para número muito curto', () => {
    assert.equal(normalizePhone('12345'), null)
  })

  test('retorna null para string vazia', () => {
    assert.equal(normalizePhone(''), null)
  })

  test('retorna null para apenas letras', () => {
    assert.equal(normalizePhone('abcdef'), null)
  })
})

describe('isValidPhone', () => {
  test('retorna true para número válido', () => {
    assert.equal(isValidPhone('+5548999990001'), true)
  })

  test('retorna false para número inválido', () => {
    assert.equal(isValidPhone('123'), false)
  })
})

describe('canonicalPhone', () => {
  test('remove toda formatação', () => {
    assert.equal(canonicalPhone('+55 (48) 99999-0001'), '5548999990001')
  })

  test('mantém apenas dígitos', () => {
    assert.equal(canonicalPhone('+5548999990001'), '5548999990001')
  })
})
