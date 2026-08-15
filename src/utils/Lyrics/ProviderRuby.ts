export type ProviderRubyTag = {
  readonly Text: string;
  readonly StartTime: number;
  readonly EndTime: number;
};

export type ProviderRubyReadable = {
  readonly ProviderRuby?: readonly ProviderRubyTag[];
};
