"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import styles from "./operator-help.module.css";

export default function OperatorHelp() {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const findTarget = () => setTarget(document.querySelector(".reception-topbar .topbar-actions"));
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target) return null;

  return createPortal(
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="受付操作のヘルプを開く">
          <CircleHelp aria-hidden="true" />
          ヘルプ
        </Button>
      </DialogTrigger>
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>使い方</DialogTitle>
          <DialogDescription>受付で使う操作だけを簡単にまとめています。</DialogDescription>
        </DialogHeader>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3>1. 受付</h3>
            <p>人数を合わせ、すぐ入れるなら<strong>「入場」</strong>、待ってもらうなら<strong>「整理券を発行」</strong>を押します。整理券は紙を渡してから<strong>「紙を渡した」</strong>を押します。</p>
          </section>

          <section className={styles.section}>
            <h3>2. 案内</h3>
            <p><strong>「次を呼ぶ」</strong>で案内する番号を呼び、来たら<strong>「入場」</strong>を押します。番号を変える必要があるときだけ<strong>「別の番号を呼ぶ」</strong>を使います。</p>
          </section>

          <section className={styles.section}>
            <h3>3. 退場</h3>
            <p>出てきたグループの<strong>「退場」</strong>を押します。複数組が一緒に出たときは選択して<strong>「まとめて退場」</strong>を使います。</p>
          </section>

          <section className={styles.section}>
            <h3>4. 間違えたとき</h3>
            <p>直前なら<strong>「最後を取り消す」</strong>を使います。それ以外の修正は<strong>「管理」</strong>から行います。</p>
          </section>
        </div>
      </DialogContent>
    </Dialog>,
    target,
  );
}
