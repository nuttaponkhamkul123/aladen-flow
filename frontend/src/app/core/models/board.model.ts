export interface Label {
  id: number;
  board_id?: number;
  name: string;
  color: string;
}

export interface ChecklistItem {
  id: number;
  card_id: number;
  text: string;
  checked: boolean;
  position: number;
}

export interface Card {
  id: number;
  column_id: number;
  title: string;
  description: string;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  position: number;
  cover?: string;
  archived?: number;
  labels?: Label[];
  checklist?: ChecklistItem[];
}

export interface Column {
  id: number;
  board_id: number;
  name: string;
  position: number;
  cards?: Card[];
}

export interface Board {
  id: number;
  name: string;
  created_at?: string;
  columns?: Column[];
  labels?: Label[];
  cards?: Card[];
}

export interface Activity {
  id: number;
  card_id: number | null;
  board_id: number | null;
  message: string;
  created_at: string;
}

export interface SearchResult {
  cards: Card[];
}
