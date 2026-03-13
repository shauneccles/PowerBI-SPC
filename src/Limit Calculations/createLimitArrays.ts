export type StandardLimitArrays = {
  targets: number[];
  ll99: number[];
  ll95: number[];
  ll68: number[];
  ul68: number[];
  ul95: number[];
  ul99: number[];
};

export default function createLimitArrays(n: number): StandardLimitArrays {
  return {
    targets: new Array<number>(n),
    ll99: new Array<number>(n),
    ll95: new Array<number>(n),
    ll68: new Array<number>(n),
    ul68: new Array<number>(n),
    ul95: new Array<number>(n),
    ul99: new Array<number>(n),
  };
}
