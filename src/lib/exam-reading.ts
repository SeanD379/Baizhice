import { chineseExamInfo } from './content';
import type { Material } from './types';

export type ReadingLandmark = { label: string; page: number; marker?: RegExp };
export type ExamReadingGuide = { intro: string; landmarks: ReadingLandmark[] };

export function examQuestionPage(name: string, question: number): number {
  const ranges = name === chineseExamInfo['2023-new-i'].name
    ? [[1, 2], [2, 3], [5, 4], [6, 6], [8, 7], [10, 8], [13, 9], [16, 10], [18, 11]]
    : name === chineseExamInfo['2024-new-i'].name
      ? [[1, 2], [2, 3], [6, 5], [10, 6], [13, 7], [18, 8]]
      : name === chineseExamInfo['2024-new-ii'].name
        ? [[1, 2], [3, 3], [6, 5], [8, 6], [10, 7], [15, 8], [18, 9]]
        : [];
  return ranges.reduce((page, [first, target]) => question >= first ? target : page, 1);
}

export function examReadingGuide(material: Pick<Material, 'name'>): ExamReadingGuide | null {
  if (material.name === chineseExamInfo['2024-new-i'].name) return {
    intro: '同一套试卷已合在这里。现代文、古代诗文、语言文字运用、写作和参考答案可在下方按页展开；原卷跨页处可能包含相邻板块。',
    landmarks: [
      { label: '现代文阅读', page: 1, marker: /一、现代文阅读/ },
      { label: '第 1–5 题', page: 2, marker: /1\s*[.．、]\s*下列/ },
      { label: '第 6–9 题', page: 5, marker: /6\s*[.．、]\s*下列/ },
      { label: '古代诗文阅读', page: 5, marker: /二、古代诗文阅读/ },
      { label: '语言文字运用', page: 7, marker: /三、语言文字运用/ },
      { label: '写作', page: 8, marker: /四、写作/ },
      { label: '现代文、文言文答案', page: 9, marker: /【\s*1\s*[~～—-]\s*5/ },
      { label: '诗歌及其他答案', page: 10, marker: /【\s*15\s*[~～—-]\s*16/ },
    ],
  };
  if (material.name === chineseExamInfo['2024-new-ii'].name) return {
    intro: '这份整卷包含现代文、古代诗文、语言文字运用和写作；原文件不含参考答案。可按页展开阅读。',
    landmarks: [
      { label: '现代文阅读', page: 1, marker: /一、现代文阅读/ },
      { label: '古代诗文阅读', page: 6, marker: /二、古代诗文阅读/ },
      { label: '语言文字运用', page: 8, marker: /三、语言文字运用/ },
      { label: '写作', page: 9, marker: /四、写作/ },
    ],
  };
  if (material.name === chineseExamInfo['2023-new-i'].name) return {
    intro: '这份整卷包含现代文、古代诗文、语言文字运用和写作；原文件不含参考答案。可按页展开阅读。',
    landmarks: [
      { label: '现代文阅读', page: 1, marker: /一、现代文阅读/ },
      { label: '古代诗文阅读', page: 7, marker: /二、古代诗文阅读/ },
      { label: '语言文字运用', page: 10, marker: /三、语言文字运用/ },
      { label: '写作', page: 11, marker: /四、写作/ },
    ],
  };
  return null;
}

export function examSectionLabel(name: string, page: number): string | null {
  if (name === chineseExamInfo['2024-new-i'].name) return page >= 9 ? '参考答案' : page >= 8 ? '写作' : page === 7 ? '古代诗文、语言文字运用' : page === 5 ? '现代文、古代诗文阅读' : page >= 6 ? '古代诗文阅读' : '现代文阅读';
  if (name === chineseExamInfo['2024-new-ii'].name) return page >= 9 ? '写作' : page >= 8 ? '语言文字运用' : page >= 6 ? '古代诗文阅读' : '现代文阅读';
  if (name === chineseExamInfo['2023-new-i'].name) return page >= 11 ? '写作' : page >= 10 ? '语言文字运用' : page >= 7 ? '古代诗文阅读' : '现代文阅读';
  return null;
}
