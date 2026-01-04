export type ContainerLine = {
  id: string;
  itemLabel: string;
  quantity: number;
};

export type Container = {
  id: string;
  label: string;
  lines: ContainerLine[];
};

export type ParsedLine = {
  itemLabel: string;
  quantity: number;
};

export type SummaryLine = {
  itemLabel: string;
  totalQuantity: number;
};