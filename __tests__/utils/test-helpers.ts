// Test utilities and helpers for agent-handheld tests

import { render, RenderOptions } from '@testing-library/react-native';
import React from 'react';

// Custom render function with providers
export interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapper?: React.ComponentType;
}

export const customRender = (
  ui: React.ReactElement,
  { wrapper: Wrapper, ...options }: CustomRenderOptions = {}
) => {
  const WrapperComponent = Wrapper || React.Fragment;
  return render(ui, { wrapper: WrapperComponent, ...options });
};

// Mock data generators
export const mockBackendConfig = {
  id: 'test-backend',
  name: 'Test Backend',
  type: 'hermes' as const,
};

export const mockSession = {
  id: 'test-session-id',
  title: 'Test Session',
  createdAt: new Date().toISOString(),
  backendId: 'test-backend',
};

export const mockMessage = {
  id: 'test-message-id',
  sessionId: 'test-session-id',
  role: 'user' as const,
  content: 'Test message content',
  timestamp: new Date().toISOString(),
};

// Wait utilities
export const waitForPromise = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Cleanup utilities
export const clearAllMocks = () => {
  jest.clearAllMocks();
  jest.resetAllMocks();
};

export const restoreAllMocks = () => {
  jest.restoreAllMocks();
};
