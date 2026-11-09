/** Resumo compacto da próxima etapa e dos controles relevantes. */
export function formatShotgunObjective(
  spiderDead: boolean,
  assembled: boolean,
  partsFound: number,
  ammo: number
): string {
  if (spiderDead) return 'OBJETIVO CONCLUÍDO · ARANHA DESTRUÍDA';
  if (!assembled) {
    return partsFound >= 4
      ? 'MONTE A SHOTGUN · [TAB]'
      : `ENCONTRE PEÇAS DA SHOTGUN · ${partsFound}/4`;
  }
  if (ammo <= 0) return 'BUSQUE CARTUCHOS NOS CAIXOTES';
  return `DESTRUA A ARANHA · ${ammo} CARTUCHOS · [H] EQUIPAR · CLIQUE ATIRAR`;
}
