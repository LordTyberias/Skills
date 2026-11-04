import { expect, test } from 'claude-code/testing'
import { effortSwitch, hasKeyword, reminder } from './register'

test('effortSwitch reads /effort ultracode on|off only', () => {
  expect(effortSwitch('ultracode on')).toBe(true)
  expect(effortSwitch(' Ultracode OFF ')).toBe(false)
  expect(effortSwitch('ultracode')).toBe(undefined)
  expect(effortSwitch('high')).toBe(undefined)
  expect(effortSwitch('')).toBe(undefined)
})

test('reminder maps the session toggle reminders only', () => {
  expect(reminder('ultra_effort_enter')).toBe(true)
  expect(reminder('ultra_effort_exit')).toBe(false)
  expect(reminder('workflow_keyword_request')).toBe(undefined)
  expect(reminder('environment')).toBe(undefined)
})

test('hasKeyword finds the keyword in typed prompts only', () => {
  expect(hasKeyword('test ultracode')).toBe(true)
  expect(hasKeyword('UltraCode please')).toBe(true)
  expect(hasKeyword('check')).toBe(false)
  expect(hasKeyword('/effort ultracode on')).toBe(false)
})
