import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Capsule, TargetBar, targetScale } from './progress';

const parts = (container: HTMLElement) => {
  const bar = container.querySelector<HTMLElement>('[data-testid="target-bar"]')!;
  const spans = [...bar.children] as HTMLElement[];
  return {
    bar,
    fill: spans[1]!,
    overflow: bar.querySelector<HTMLElement>('.bar-overflow'),
    marker: spans.find((s) => s.className.includes('bg-foreground')) ?? null,
  };
};

describe('targetScale', () => {
  it('leaves a quarter past the target, or reaches the value when it is further', () => {
    expect(targetScale(100, 480)).toBe(600);
    expect(targetScale(700, 480)).toBe(700);
    expect(targetScale(0, 0)).toBe(1);
  });
});

describe('TargetBar', () => {
  it('fills up to the value below the target, with the marker and no stripes', () => {
    const { container } = render(<TargetBar value={240} target={480} />);
    const { bar, fill, overflow, marker } = parts(container);
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(fill.style.width).toBe('40%');
    expect(overflow).toBeNull();
    expect(marker!.style.left).toBe('80%');
  });

  it('stripes the part past the target', () => {
    const { container } = render(<TargetBar value={600} target={480} />);
    const { fill, overflow, marker } = parts(container);
    expect(fill.style.width).toBe('80%');
    expect(overflow!.style.left).toBe('80%');
    expect(overflow!.style.width).toBe('20%');
    expect(marker!.style.left).toBe('80%');
  });

  it('has no marker and no stripes without a target', () => {
    const { container } = render(<TargetBar value={120} target={0} scale={480} />);
    const { fill, overflow, marker } = parts(container);
    expect(fill.style.width).toBe('25%');
    expect(overflow).toBeNull();
    expect(marker).toBeNull();
  });

  it('never draws outside its track', () => {
    const { container } = render(<TargetBar value={-50} target={480} scale={480} />);
    expect(parts(container).fill.style.width).toBe('0%');
  });
});

describe('Capsule', () => {
  it('writes the value inside a wide enough fill and the rest after it', () => {
    const { container } = render(<Capsule percent={64} inside="64 %" after="12 left" size="lg" />);
    const fill = container.querySelector<HTMLElement>('.capsule-fill')!;
    expect(fill.style.width).toBe('64%');
    expect(fill).toHaveTextContent('64 %');
    expect(screen.getByText('12 left')).toBeInTheDocument();
  });

  it('moves the value out of a narrow fill', () => {
    const { container } = render(<Capsule percent={10} inside="10 %" />);
    expect(container.querySelector('.capsule-fill')).not.toHaveTextContent('10 %');
    expect(screen.getByText('10 %')).toBeInTheDocument();
  });

  it('clamps odd percentages and hides an empty fill', () => {
    const { container, rerender } = render(<Capsule percent={140} tone="success" />);
    const fill = () => container.querySelector<HTMLElement>('.capsule-fill')!;
    expect(fill().style.width).toBe('100%');
    expect(fill().dataset.tone).toBe('success');
    rerender(<Capsule percent={-3} />);
    expect(fill().style.width).toBe('0%');
    expect(fill().className).toContain('invisible');
  });
});
