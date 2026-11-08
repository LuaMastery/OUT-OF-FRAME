# OUT-OF-FRAME

Jogo 3D em Primeira Pessoa inspirado em **Superhot** combinado com **Manipulação Espacial de Moldura (SE(3) Sub-Frustum Capture & Reprojection)**.

> **Marco atual:** Núcleo Arquitetural Desacoplado + Sala de Testes Interativa (`v0.1`).

## Como executar localmente

```bash
npm install
npm run dev
```

Para rodar os testes automatizados do motor (ECS geracional, Dual-Clock, Sub-Frustum SE(3) e CCD):

```bash
npm test
```

## Comandos na Sala de Testes

| Comando | Ação |
| --- | --- |
| `W A S D` + `Espaço` | Mover e saltar (**governa a passagem do tempo**) |
| `Mouse` / `Setas` | Olhar e mirar (opera em tempo real mesmo com o mundo congelado) |
| `Clique Esquerdo` / `F` | Disparar pulso cinético |
| `Clique Direito` / `E` | **Recortar** objetos enquadrados / **Reprojetar** objetos em estase |
| `R` | **Virar o Negativo** (espelha a chapa e inverte o sentido de projéteis capturados) |
| `V` | Fixar/soltar visualização 3D da pirâmide do Sub-Frustum no mundo |
| `C` | Alternar modo do `ChronoKernel` (`Superhot` / `Congelado` / `Tempo Real`) |
| `Tab` | Exibir/ocultar painel de Telemetria do Motor |
| `T` | Resetar todas as estações da Sala de Testes |
| `M` | Silenciar/ativar sintetizador WebAudio |

Consulte [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) para os detalhes das técnicas de programação do motor.
