# ADR-0001: PTY の子プロセスグループ清掃

## 決定

Python 標準ライブラリと既存の forkpty を維持し、helper の終了経路で子プロセスグループを清掃する。Claude の直接の子 PID をグループ ID として使い、helper 自身のグループと1以下の ID にはシグナルを送らない。

PTY を閉じてから SIGHUP と SIGCONT を送る。`EXIT_GRACE_SECONDS=0.25` の後に SIGKILL を送り、最後に waitpid する。清掃前に直接の子を reap しないため、その PID が清掃中に別のプロセスへ再利用されることを防ぐ。Node 側の3秒の helper 終了猶予より短くする。

Claude 本体の終了は `CHILD_POLL_SECONDS=0.1` の周期で waitid(WEXITED | WNOHANG | WNOWAIT) を呼び、reap せず検出する。孫が PTY を継承している場合は本体終了後も EOF が来ないため、select と EOF だけでは終了を判断しない。

## 背景

Node から Python helper だけを SIGKILL すると、SIGHUP を無視する Claude と子孫が残留した。終了の責務を PTY とグループを作った Python に集め、stdin EOF、helper への通常の終了シグナル、PTY の終了、stdout を含む中継 I/O エラーを同じ finally へ集約する。

## Jev 決定表

| 論点 | 選択 | 理由 |
|---|---|---|
| PTY の起動方式 | forkpty 継続 | 子側の独立セッション／グループを利用できる |
| 清掃単位 | 子のプロセスグループ | 単独 PID の終了では通常の子孫を取りこぼす |
| シグナル列 | HUP・CONT、猶予、KILL | 停止中・HUP 無視の両方に対応する |
| PID 回収の順序 | グループ清掃後に waitpid | 清掃途中の PID 再利用を防ぐ |
| OS 固有の追加機構 | 導入しない | Linux の cgroup／subreaper と macOS 固有の差を増やさない |
| 脱出する子孫 | 保証対象外 | setsid／setpgid で別グループへ移ったプロセスまでを killpg は追跡しない |

## 検証と限界

SIGHUP を無視する親と同じグループの孫を実際に起動し、TuiSession.close、helper への SIGTERM、Claude 本体への SIGTERM、PTY を継承した孫を伴う本体への SIGTERM の4条件で生存プロセスが残らないことを確認する。子孫は直接の子ではないため、OS の init に回収される一時的な zombie と実行中プロセスは区別する。

helper 自体が外部から SIGKILL された場合や、カーネル内で終了不能になったプロセスまでは保証しない。macOS の実機検証も未実施である。自律設計判定には fast_grill を使用し、提案の1秒猶予ではなく、実装と試験に合わせて0.25秒を採用した。
