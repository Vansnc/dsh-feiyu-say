#!/usr/bin/env python3
"""重采样兜底（dsh-feiyu-say 用）。

ffmpeg 不是必需的了：装了就走 ffmpeg（行为与以前一致），没装就用这段把 WAV 转成
目标采样率 / 单声道 / 16bit。依赖 scipy + soundfile，CosyVoice 的 venv 里本来就有。

用法: python resample.py <src.wav> <out.wav> <rate>
"""
import sys
from math import gcd

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly


def main():
    if len(sys.argv) < 4:
        print("用法: resample.py <src> <out> <rate>", file=sys.stderr)
        sys.exit(2)
    src, out, 目标 = sys.argv[1], sys.argv[2], int(sys.argv[3])

    # always_2d：两声道也能按单声道取平均处理
    数据, sr = sf.read(src, dtype="float32", always_2d=True)
    if 数据.size == 0:
        print("输入音频是空的：" + src, file=sys.stderr)
        sys.exit(3)
    x = 数据.mean(axis=1)

    if sr != 目标:
        # 用有理数上下采样，44100→8000 这种也能精确表达（gcd 约分，不做浮点重采样）
        g = gcd(int(sr), int(目标))
        x = resample_poly(x, 目标 // g, int(sr) // g)
    x = np.clip(x, -1.0, 1.0).astype("float32")

    sf.write(out, x, 目标, subtype="PCM_16")
    print("ok", out, 目标)


if __name__ == "__main__":
    main()
