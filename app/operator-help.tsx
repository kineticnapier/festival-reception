"use client";

import { CircleHelp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import styles from "./operator-help.module.css";

export default function OperatorHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={styles.launcher} aria-label="受付操作のヘルプを開く">
          <CircleHelp aria-hidden="true" />
          <span>ヘルプ</span>
        </button>
      </DialogTrigger>
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>受付操作ヘルプ</DialogTitle>
          <DialogDescription>本番中に迷いやすい操作だけをまとめています。</DialogDescription>
        </DialogHeader>

        <div className={styles.body}>
          <div className={styles.quickRule}>
            定員を超えて入場させない・紙を渡す前に次へ進まない・案内は1回につき1グループ。
          </div>

          <section className={styles.section}>
            <h3>受付</h3>
            <p>
              人数を入力し、空きがあってそのまま入れる場合は<strong>「入場」</strong>、混雑時は<strong>「整理券を発行」</strong>を使います。
              定員を超える大人数グループは、自動で定員以下の複数グループへなるべく均等に分割されます。
            </p>
          </section>

          <section className={styles.section}>
            <h3>分割されたグループ</h3>
            <p>
              同じ団体として内部で紐付いています。先のグループが入場中で、残りのグループが<strong>今の空き人数に収まるときだけ</strong>続けて案内を優先します。
              入れない間は他のグループを案内するため、全員同時入場や連続入場は保証しません。
            </p>
          </section>

          <section className={styles.section}>
            <h3>紙整理券</h3>
            <p>
              画面に表示された番号の紙を実際に渡してから<strong>「紙を渡した」</strong>を押します。分割時も1枚ずつ、受け渡し確認をしてから次の番号へ進みます。
            </p>
          </section>

          <section className={styles.section}>
            <h3>案内</h3>
            <p>
              基本は<strong>「次を呼ぶ」</strong>を使います。人数・待ち時間・空き状況を見てシステムが案内候補を決めます。特別な事情がある場合だけ番号指定を使います。
            </p>
          </section>

          <section className={styles.section}>
            <h3>退場</h3>
            <p>
              退場したグループの<strong>「退場」</strong>を押します。複数グループが同時に出た場合は選択して<strong>「まとめて退場」</strong>を使えます。
            </p>
          </section>

          <section className={styles.section}>
            <h3>間違えたとき</h3>
            <p>
              直前の操作なら<strong>「最後を取り消す」</strong>、それ以外は管理画面から修正します。通信中は同じボタンを連打せず、完了表示を待ってください。
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
