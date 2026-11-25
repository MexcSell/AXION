import { describe, it, expect } from 'vitest';
import { catalogDepartments } from '../../web/src/data/departments.ts';

describe('department heads from the agent catalog', () => {
  const engineering = [
    { id: 'z', name: 'Z', dept: 'Engineering', managerId: 'gm' },
    { id: 'b', name: 'B', dept: 'Engineering', managerId: 'z' },
    { id: 'c', name: 'C', dept: 'Engineering', managerId: 'gm' },
  ];

  it('uses the first member by name reporting outside the department', () => {
    expect(catalogDepartments(engineering)).toMatchObject([{ name: 'Engineering', managerId: 'c' }]);
  });

  it('keeps departments with no recorded head and returns no departments for an empty catalog', () => {
    expect(catalogDepartments([])).toEqual([]);
    expect(catalogDepartments([{ id: 'v', name: 'V', dept: 'Validation' }])).toMatchObject([{ name: 'Validation', managerId: undefined }]);
  });
});
