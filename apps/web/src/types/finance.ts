export type TransactionType = "income" | "expense";

export type Transaction = {
  id: string;
  title: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string; // ISO string
};

export type Category = {
  id: string;
  name: string;
  color?: string;
  icon?: string; // Emoji
  lastUsed?: string; // ISO Date of last usage
};
