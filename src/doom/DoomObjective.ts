/** Resumo compacto da próxima etapa e dos controles relevantes. */
export function formatShotgunObjective(
  spiderDead: boolean,
  assembled: boolean,
  partsFound: number,
  ammo: number,
  partsTotal = 4
): string {
  if (spiderDead) return 'OBJETIVO CONCLUÍDO · ARANHA DESTRUÍDA';
  if (!assembled) {
    const total = Math.max(1, partsTotal);
    return partsFound >= total
      ? 'MONTE A SHOTGUN · [TAB]'
      : `PEÇAS NAS SALAS ESPECIAIS · ${partsFound}/${total}`;
  }
  if (ammo <= 0) return 'BUSQUE CARTUCHOS NOS CAIXOTES';
  return `DESTRUA A ARANHA · ${ammo} CARTUCHOS · [H] EQUIPAR · CLIQUE ATIRAR`;
}
