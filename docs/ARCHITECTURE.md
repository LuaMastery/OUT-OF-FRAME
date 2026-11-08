# Arquitetura do Motor `OUT-OF-FRAME`

Este documento descreve a arquitetura desacoplada e as **técnicas especiais de programação de jogos** utilizadas para unir a lei temporal do *Superhot* à manipulação espacial de molduras em 3D.

---

## 1. Micro-ECS com Handles Geracionais e Exclusão por Bitmask (`src/engine/ecs/`)

Em jogos onde dezenas de projéteis, estilhaços e alvos são criados, recortados do espaço e destruídos por segundo, hierarquias de herança OOP tradicionais (`class EnemyBullet extends MovingEntity`) geram dois problemas clássicos:
1. **Referências obsoletas (*dangling references*)** quando um slot reciclado aponta para outro objeto.
2. **Poluição condicional (`if (!this.isInFrame)`)** espalhada em física, IA, timers e colisões.

### Solução adotada:
- **Handles Geracionais de 32 bits (`EntityId`)**: `20 bits` de índice + `12 bits` de geração. Ao destruir uma entidade, o slot volta ao pool incrementando sua geração — qualquer handle antigo é invalidado em `O(1)`.
- **Estase Espacial via Máscara de Exclusão (`PocketStasis`)**: Quando o jogador recorta entidades para dentro da moldura, o `FrameSystem` apenas liga o bit `PocketStasis` na máscara da entidade. Todos os sistemas do mundo consultam `world.query(withMask, PocketStasis.bit)` — pausando instantaneamente gravidade, velocidade, recarga de IA e colisão **sem um único `if` acoplado** nos sistemas.

---

## 2. Núcleo Temporal Dual-Clock com Interpolação Residual (`src/engine/time/ChronoKernel.ts`)

Multiplicar velocidades diretamente por `deltaTime * timeScale` em `requestAnimationFrame` quebra a determinística balística e causa *jitter* em câmera ultra-lenta.

### Solução adotada (Técnica *Fix Your Timestep* Dilatada):
- **`realDt` (Relógio Humano)**: Governa rotação de câmera FPS, HUD, viewfinder e decaimento de filtros — mirar nunca fica travado quando o tempo para.
- **`simDt` (Relógio Físico Fixo em `1/120s`)**: Alimentado por um acumulador dilatado (`accumulator += realDt * timeScale`). Em `0.025x`, o mundo avança apenas ~3 passos físicos por segundo, mantendo precisão matemática idêntica à de `1.00x`.
- **Interpolação C0 Contínua (`alpha = accumulator / fixedSimStep`)**: O `RenderSyncSystem` faz `lerp(prevPos, currPos, alpha)` e `slerp(prevQuat, currQuat, alpha)` a 60–144 Hz, eliminando qualquer engasgo visual em câmera lenta.

---

## 3. Sub-Frustum Off-Axis e Transformação SE(3) com Polaridade (`src/engine/math/SubFrustum.ts`)

A moldura central do HUD (`36vw × 38vh`) corresponde exatamente ao retângulo normalizado NDC `[-0.36, +0.36] × [-0.38, +0.38]`.

1. **Matriz Perspectiva Off-Axis**: Construímos uma matriz de projeção assimétrica restrita à sub-janela da moldura e extraímos os **6 planos exatos do `THREE.Frustum`** no espaço do mundo, combinados com *raycast* de oclusão (`hasLineOfSight`) para capturar apenas o que é realmente visível na janela.
2. **Captura em Espaço da Lente (`SE(3)`)**:
   $$p_{\text{local}} = q_{\text{cam}}^{-1}(p_{\text{world}} - c_{\text{cam}}), \quad v_{\text{local}} = q_{\text{cam}}^{-1} v_{\text{world}}$$
3. **Inversão de Negativo (`[R]`)**:
   Ao virar a chapa fotográfica para o modo **Negativo Invertido**:
   - Posição espelha horizontalmente na lente: $(x, y, z) \mapsto (-x, y, z)$
   - Vetores de velocidade giram $180^\circ$ no eixo vertical da lente: $(v_x, v_y, v_z) \mapsto (-v_x, v_y, -v_z)$
   - **Efeito emergente**: Projéteis inimigos capturados enquanto voavam *na direção do seu rosto* passam a disparar *para fora da sua moldura* contra qualquer alvo enquadrado!

---

## 4. Detecção Contínua de Colisão por Segmento Varrido — CCD (`src/engine/physics/SpatialSweep.ts`)

Projéteis rápidos utilizam interseção analítica **Slab Method (Kay-Kajiya)** e **Segmento-Esfera** ao longo de todo o vetor `[posAnterior -> posAtual]`, impedindo *tunneling* através de paredes finas, permitindo ricochete em painéis defletores ($v' = v - 2(v \cdot n)n$), choque projétil-contra-projétil em pleno ar e *clamping* de segurança ao colar objetos próximos a paredes.

---

## 5. Shaders GLSL Analíticos & Chapa `WebGLRenderTarget` (`src/engine/render/`)

- **`GridMaterial.ts`**: Grade arquitetônica triplanar anti-serrilhada via derivadas parciais de espaço de tela (`fwidth`), reagindo sutilmente ao `uTimeScale`.
- **`FramePipView.ts`**: Renderiza o sub-frustum exato em um `WebGLRenderTarget` offscreen no instante do recorte e revela a imagem na chapa do HUD (incluindo inversão cromática e espelhamento no modo Negativo).

---

## 6. Áudio Procedural WebAudio Modulado pelo Tempo (`src/engine/audio/ProceduralAudio.ts`)

Zero arquivos `.mp3` externos: osciladores, ruído filtrado e ressonadores cristalinos passam por um `BiquadFilterNode` passa-baixas mestre cuja frequência de corte varia exponencialmente de `~125 Hz` (tempo congelado) a `~9.200 Hz` (velocidade real).
