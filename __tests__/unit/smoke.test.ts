import { describe, it, expect } from '@jest/globals';

// Simple smoke test to verify Jest setup works
describe('Jest Setup', () => {
  it('should pass a basic test', () => {
    expect(true).toBe(true);
  });

  it('should handle numbers correctly', () => {
    const result = 2 + 2;
    expect(result).toBe(4);
  });

  it('should handle strings correctly', () => {
    const greeting = 'Hello, World!';
    expect(greeting).toContain('World');
  });
});
