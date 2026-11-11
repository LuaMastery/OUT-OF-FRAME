import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DoomAstronaut } from '../src/doom/DoomAstronaut';
import { DoomFlashlight } from '../src/doom/DoomFlashlight';
import { DoomShotgunViewmodel } from '../src/doom/DoomShotgun';
import { QUICK_ITEM_DURATIONS, QuickHandheldKind, parseQuickItemAction } from '../src/doom/DoomItemAction';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { computeDoomDancePose } from '../src/doom/DoomDance';

describe('Objetos e ações 3D dos aliados', () => {
  it('replica cada objeto real no encaixe da mão e anima o golpe ou a coleta sem alterar a cópia local', () => {
    const flashlight = new DoomFlashlight(16 / 9);
    const scene = new THREE.Scene();
    const ally = new DoomAstronaut(scene, createDoomSharedUniforms());
    const items = flashlight.createThirdPersonQuickProps();
    ally.setThirdPersonItemProps(items);
    expect(ally.thirdPersonItemGroup.parent).toBe(ally.leftArm.gripSocket);
    const localBlade = flashlight.leftAstronautArm.gripSocket.getObjectByName('AstronautPocketKnifeBladePivot')!;
    const localRotation = localBlade.rotation.x;
    for (const kind of Object.keys(QUICK_ITEM_DURATIONS) as QuickHandheldKind[]) {
      flashlight.triggerQuickItemAction(kind);
      const snapshot = flashlight.quickItemAction!;
      expect(snapshot.kind).toBe(kind);
      ally.updateThirdPersonAlly(new THREE.Vector3(), 0, 0, 0, 0, 0, false, false);
      ally.applyThirdPersonItemAction({ ...snapshot, progress: 0.5 });
      expect(ally.thirdPersonItemGroup.visible).toBe(true);
      expect(items[kind].visible).toBe(true);
      expect(Object.values(items).filter(item => item.visible)).toEqual([items[kind]]);
      expect(items[kind].children.length).toBeGreaterThan(0);
    }
    ally.applyThirdPersonItemAction({ kind: 'knife', progress: 0.5, mode: 'pickup' });
    expect(items.knife.getObjectByName('AstronautPocketKnifeBladePivot')!.rotation.x).toBeCloseTo(-2.05);
    expect(localBlade.rotation.x).toBe(localRotation);
    flashlight.triggerQuickItemAction('knife', 'pickup');
    expect(flashlight.quickItemAction?.mode).toBe('pickup');
    flashlight.update(0.5, 0, 0, () => {});
    expect(flashlight.quickItemAction).toBeNull();
    ally.updateThirdPersonAlly(new THREE.Vector3(), 0, 0, 0, 0, 0, false, false);
    expect(ally.thirdPersonItemGroup.visible).toBe(false);
  });

  it('mantém armas distintas visíveis somente enquanto equipadas e preserva prioridades das poses', () => {
    const ally = new DoomAstronaut(new THREE.Scene(), createDoomSharedUniforms());
    const shotgun = new DoomShotgunViewmodel(1);
    ally.setThirdPersonWeaponProps({ shotgun: shotgun.createThirdPersonWeapon() });
    ally.setThirdPersonItemProps(new DoomFlashlight(1).createThirdPersonQuickProps());
    ally.updateThirdPersonAlly(new THREE.Vector3(), 0, 0, 0, 0, 0, true, false);
    ally.applyThirdPersonHeldWeapon('shotgun');
    expect(ally.thirdPersonFlashlightGroup.visible).toBe(true);
    expect(ally.thirdPersonWeaponGroup.getObjectByName('AstronautThirdPersonWeapon-shotgun')?.visible).toBe(true);
    ally.applyThirdPersonItemAction({ kind: 'knife', progress: 0.5 });
    expect(ally.thirdPersonWeaponGroup.visible).toBe(false);
    ally.updateThirdPersonAlly(new THREE.Vector3(), 0, 0, 0, 0, 0, false, true);
    expect(ally.thirdPersonItemGroup.visible).toBe(false);
    ally.applyDancePose(computeDoomDancePose('robot', 0.1), new THREE.Vector3(), 0);
    expect(ally.thirdPersonWeaponGroup.visible).toBe(false);
    expect(ally.thirdPersonItemGroup.visible).toBe(false);
  });

  it('recusa pacotes inválidos e aceita clientes antigos sem campos de ação', () => {
    expect(parseQuickItemAction(undefined)).toBeNull();
    expect(parseQuickItemAction({ kind: 'knife', progress: NaN })).toBeNull();
    expect(parseQuickItemAction({ kind: '__proto__', progress: 0.2 })).toBeNull();
    expect(parseQuickItemAction({ kind: 'knife', progress: 1 })).toBeNull();
    expect(parseQuickItemAction({ kind: 'knife', progress: 0.2, mode: 'bogus' })).toBeNull();
    expect(parseQuickItemAction({ kind: 'knife', progress: 0.2 })).toEqual({ kind: 'knife', progress: 0.2, mode: 'use' });
  });
});
