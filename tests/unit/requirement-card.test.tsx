/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import RequirementCard from '../../src/renderer/components/Chat/RequirementCard';
import type { RequirementSummary } from '../../src/shared/types/project';

const req: RequirementSummary = {
  goal: '个人使用的收支记录工具',
  targetUsers: '个人使用',
  coreFeatures: ['记录收支', '分类统计'],
  visualStyle: '简洁',
  confirmed: false,
};

describe('需求卡片（RequirementCard）', () => {
  it('渲染需求字段', () => {
    render(<RequirementCard requirements={req} onConfirm={() => undefined} />);
    expect(screen.getByText('个人使用的收支记录工具')).toBeTruthy();
    expect(screen.getByText('个人使用')).toBeTruthy();
    expect(screen.getByText('记录收支')).toBeTruthy();
    expect(screen.getByText('分类统计')).toBeTruthy();
  });

  it('未确认时显示确认按钮，点击触发回调', () => {
    const onConfirm = jest.fn();
    render(<RequirementCard requirements={req} onConfirm={onConfirm} />);
    const btn = screen.getByText('确认需求，开始开发');
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('已确认状态不显示确认按钮', () => {
    render(
      <RequirementCard
        requirements={{ ...req, confirmed: true }}
        status="ready"
        onConfirm={() => undefined}
      />,
    );
    expect(screen.queryByText('确认需求，开始开发')).toBeNull();
    expect(screen.getByText(/已确认/)).toBeTruthy();
  });

  it('开发中状态显示进度提示', () => {
    render(<RequirementCard requirements={req} status="developing" onConfirm={() => undefined} />);
    expect(screen.getByText(/开发团队正在工作/)).toBeTruthy();
  });
});
