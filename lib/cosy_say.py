#!/usr/bin/env python3
"""CosyVoice 合成脚本（dsh-feiyu-say 用，跨平台，公开 CosyVoice）。

用法:
  python cosy_say.py --model <模型目录> --text "…" --out out.wav
              [--mode sft|zero_shot] [--spk 中文女] [--prompt-wav ref.wav --prompt-text "…"]
              [--speed 1.0]

默认 mode=sft（CosyVoice 原声，不换声，不用参考音频）。想指定音色：
  - sft：用 --spk（先 list_avaliable_spks 看有哪些）
  - zero_shot：用 --prompt-wav + --prompt-text 克隆参考音频的嗓子

兼容 CosyVoice2 / CosyVoice1 / CosyVoice3(AutoModel)，按顺序尝试加载。
"""
import argparse
import os
import sys

import numpy as np  # noqa: F401  （CosyVoice 内部可能隐式依赖）


def _load_model(model_dir):
    """按 CosyVoice2 → CosyVoice → AutoModel 的顺序尝试实例化。"""
    last = None
    for attempt in ("CosyVoice2", "CosyVoice", "AutoModel"):
        try:
            from cosyvoice.cli.cosyvoice import CosyVoice2, CosyVoice  # noqa: F401
            if attempt == "CosyVoice2":
                cls = CosyVoice2
            elif attempt == "CosyVoice":
                cls = CosyVoice
            else:
                from cosyvoice.cli.cosyvoice import AutoModel
                cls = AutoModel
            try:
                return cls(model_dir, load_jit=False, load_trt=False, fp16=False)
            except TypeError:
                return cls(model_dir)
        except Exception as e:  # noqa: BLE001
            last = e
            continue
    raise RuntimeError("无法导入 CosyVoice：" + str(last))


def _call_inference(cosyvoice, args):
    """按参数调用对应推理，返回 (generator, sample_rate)。"""
    sr = getattr(cosyvoice, "sample_rate", 22050)

    def _with_speed(fn):
        try:
            return fn(speed=args.speed)
        except TypeError:
            return fn()

    if args.mode == "zero_shot":
        if not args.prompt_wav:
            raise ValueError("zero_shot 需要 --prompt-wav")
        return _with_speed(lambda speed=None: cosyvoice.inference_zero_shot(
            args.text, args.prompt_text or "", args.prompt_wav,
            **({"stream": False} if speed is None else {"stream": False, "speed": speed})
        )), sr

    # sft
    try:
        return _with_speed(lambda speed=None: cosyvoice.inference_sft(
            args.text, args.spk or None,
            **({"stream": False} if speed is None else {"stream": False, "speed": speed})
        )), sr
    except Exception:
        # 没给 spk 或签名不同，退化成不传 spk
        return _with_speed(lambda speed=None: cosyvoice.inference_sft(
            args.text, **({"stream": False} if speed is None else {"stream": False, "speed": speed})
        )), sr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", default="sft", choices=["sft", "zero_shot"])
    ap.add_argument("--spk", default="")
    ap.add_argument("--prompt-wav", default="")
    ap.add_argument("--prompt-text", default="")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--repo", default="", help="CosyVoice 仓库根目录，插到 sys.path 最前")
    args = ap.parse_args()

    if args.repo:
        for p in (os.path.join(args.repo, 'third_party', 'Matcha-TTS'), args.repo):
            if p not in sys.path:
                sys.path.insert(0, p)
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

    import torch
    import torchaudio

    cosyvoice = _load_model(args.model)
    gen, sr = _call_inference(cosyvoice, args)

    chunks = list(gen)
    if not chunks:
        print("合成无输出", file=sys.stderr)
        sys.exit(3)

    # 多 chunk 拼接成一段
    if len(chunks) == 1:
        wav = chunks[0]["tts_speech"]
    else:
        wav = torch.cat([c["tts_speech"] for c in chunks], dim=-1)

    torchaudio.save(args.out, wav, sr)
    print("ok", args.out)


if __name__ == "__main__":
    main()
