import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import ErrorBoundary from '../ErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('boom');
}

const render = (node: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return JSON.stringify(tree.toJSON());
};

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    const json = render(
      <ErrorBoundary>
        <Text>safe content</Text>
      </ErrorBoundary>,
    );
    expect(json).toContain('safe content');
    expect(json).not.toContain('Something went wrong');
  });

  it('renders the recoverable fallback when a child throws', () => {
    // React logs caught render errors to console.error; silence it for clean output.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const json = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(json).toContain('Something went wrong');
    expect(json).toContain('Try again');
    spy.mockRestore();
  });
});
