import { documentLabel } from './document-labels';
import type { Material } from './types';

export type LibraryFilters = {
  minSize: string; maxSize: string; unit: 'KB' | 'MB';
  fromDate: string; toDate: string; types: string[];
  sortBy: 'createdAt' | 'size' | 'name'; direction: 'asc' | 'desc';
};
export const defaultLibraryFilters: LibraryFilters = { minSize: '', maxSize: '', unit: 'MB', fromDate: '', toDate: '', types: [], sortBy: 'createdAt', direction: 'desc' };
export const moveConfirmationDateKey = 'study-workbench:library:move-confirmed-date';
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validateLibraryFilters(filters: LibraryFilters) {
  for (const value of [filters.minSize, filters.maxSize]) {
    if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) return '文件大小必须是大于或等于 0 的数字。';
  }
  if (filters.minSize && filters.maxSize && Number(filters.minSize) > Number(filters.maxSize)) return '最小文件大小不能超过最大值。';
  for (const value of [filters.fromDate, filters.toDate]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || localDay(new Date(`${value}T00:00:00`)) !== value)) return '请选择有效的导入日期。';
  }
  if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) return '开始日期不能晚于结束日期。';
  return '';
}
export function filterLibraryMaterials(materials: Material[], filters: LibraryFilters) {
  const multiplier = filters.unit === 'KB' ? 1024 : 1024 * 1024;
  const from = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00`).getTime() : -Infinity;
  const end = filters.toDate ? new Date(`${filters.toDate}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);
  return materials.filter(material => (
    (!filters.minSize || material.size >= Number(filters.minSize) * multiplier) &&
    (!filters.maxSize || material.size <= Number(filters.maxSize) * multiplier) &&
    new Date(material.createdAt).getTime() >= from && (!end || new Date(material.createdAt).getTime() < end.getTime()) &&
    (!filters.types.length || filters.types.includes(documentLabel(material.mime)))
  )).sort((a, b) => {
    const comparison = filters.sortBy === 'size' ? a.size - b.size : filters.sortBy === 'name' ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return (filters.direction === 'asc' ? comparison : -comparison) || a.id.localeCompare(b.id);
  });
}
