export interface LetterTemplateResponse {
  id: number;
  name: string;
  letterType: string;
  content: string;
  isDefault: boolean;
  isActive: boolean;
  fields?: any[];
  createdAt: string;
  updatedAt: string;
}

export interface LetterFieldValueResponse {
  id: number;
  templateId: number;
  fieldKey: string;
  value: string;
  employeeId: string;
}

export interface RenderedLetterResponse {
  templateId: number;
  templateName: string;
  letterType: string;
  employeeId: string;
  renderedHtml: string;
  tokensReplaced: Record<string, string>;
}
