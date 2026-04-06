import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'
import { renderTemplate, extractVariables } from './template'

describe('renderTemplate', () => {
  test('substitui variável simples', () => {
    assert.equal(
      renderTemplate('Olá, {{nome}}!', { nome: 'João' }),
      'Olá, João!'
    )
  })

  test('substitui múltiplas variáveis', () => {
    assert.equal(
      renderTemplate('{{nome}} — {{telefone}}', { nome: 'Maria', telefone: '+5548999' }),
      'Maria — +5548999'
    )
  })

  test('mantém variável se não encontrada no contexto', () => {
    assert.equal(
      renderTemplate('Olá, {{nome}}!', {}),
      'Olá, {{nome}}!'
    )
  })

  test('substitui múltiplas ocorrências da mesma variável', () => {
    assert.equal(
      renderTemplate('{{nome}}, olá {{nome}}!', { nome: 'Ana' }),
      'Ana, olá Ana!'
    )
  })

  test('não altera texto sem variáveis', () => {
    assert.equal(
      renderTemplate('Sem variáveis aqui.', { nome: 'João' }),
      'Sem variáveis aqui.'
    )
  })

  test('string vazia retorna string vazia', () => {
    assert.equal(renderTemplate('', { nome: 'João' }), '')
  })
})

describe('extractVariables', () => {
  test('extrai variáveis de um template', () => {
    const vars = extractVariables('Olá {{nome}}, seu telefone é {{telefone}}')
    assert.deepEqual(vars.sort(), ['nome', 'telefone'])
  })

  test('deduplicação: mesma variável aparece uma vez', () => {
    const vars = extractVariables('{{nome}} {{nome}} {{nome}}')
    assert.deepEqual(vars, ['nome'])
  })

  test('retorna array vazio se sem variáveis', () => {
    assert.deepEqual(extractVariables('Sem variáveis'), [])
  })
})
