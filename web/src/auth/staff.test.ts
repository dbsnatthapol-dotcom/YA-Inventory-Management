import { describe, expect, it } from 'vitest'
import { homePage, ROLES } from './staff'

describe('landing page by role', () => {
  it('opens the 2D warehouse plan for floor staff and the 3D factory map for everyone else', () => {
    expect(Object.fromEntries(ROLES.map((r) => [r, homePage(r)]))).toEqual({
      warehouse: 'plan',
      mi3: 'plan',
      production: 'plan',
      planner: 'map',
      engineer: 'map',
      manager: 'map',
      admin: 'map',
    })
    // หน้าสาธิต (ไม่ได้ login)
    expect(homePage(null)).toBe('map')
  })
})
