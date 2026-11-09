# bi-dwh-query-core

BI集計の問い合わせを、RDS（MySQL / PostgreSQL）と Amazon Athena（S3 + Iceberg）のどちらでも実行できるようにする核です。

- 呼び出し側（集計の処理）は、データソース（`BiDataSource`）と方言（`SqlDialect`）のインターフェースだけを使います。どちらのエンジンで実行されるかは、呼び出し側からは見えません。
- 期間から、RDS と Athena のどちらで実行するかを決めます。直近は RDS、それより前は Athena です。
- RDS への接続の仕方は核に含めません。ORM ごとのパッケージが、RDS のSQL実行役を用意しています。

| 使っている ORM | 入れるパッケージ |
| --- | --- |
| TypeORM 0.2 / 0.3 | [bi-dwh-query-for-typeorm](https://github.com/two-six-code-management/bi-dwh-query-for-typeorm) |
| Sequelize 4 以降 | [bi-dwh-query-for-sequelize](https://github.com/two-six-code-management/bi-dwh-query-for-sequelize) |

どちらのパッケージも、この核の機能をそのまま再エクスポートしています。使う側は、ORM のパッケージを1つ入れるだけで済み、この核を直接入れる必要はありません。上の2つ以外の部品で RDS に接続するときだけ、この核を入れて実行役を自分で書きます（[実行役を自分で書く](#実行役を自分で書く)）。

## 構成

| インターフェース | 実装 | 役割 |
| --- | --- | --- |
| `SqlDialect` | `MySqlDialect` / `PostgresDialect` / `TrinoDialect` | エンジンごとに違うSQLの書き方（真偽値・2列の重複なし件数・GROUP BY・日付の計算など） |
| `BiQueryEngine` | `RdsQueryEngine` / `AthenaQueryEngine` | 問い合わせを実行して行を返す |
| `RdsSqlRunner` | ORM のパッケージが用意する | RDS へSQLを流す。RDS の種類（`mysql` / `postgres`）を返す |
| `EngineSelectionPolicy` | `FixedEnginePolicy` / `RetentionWindowPolicy` | 期間から実行するエンジンを決める |
| ― | `BiDataSource` | 上の部品を組み合わせ、`select(query)` で実行する |

### 実行先の決め方（RetentionWindowPolicy）

| 期間 | 実行先 |
| --- | --- |
| `{from, to}` で、`from` が「今日 − RDS の保持日数」以降 | RDS（当日分も含めて RDS にある） |
| `{from, to}` で、それより前 | Athena |
| `BI_PERIOD.ALL_PERIOD`（全期間を読む） | Athena |
| `BI_PERIOD.CURRENT_STATE`（今の状態だけを読む） | RDS |

- 設定のエンジンが `rds` なら、期間に関係なく常に RDS です（`FixedEnginePolicy`）。
- Athena で失敗しても、RDS へは切り替えません。誤った期間のデータを黙って返さないためです。

## 使い方

例は TypeORM のパッケージで書いています。Sequelize のときは、パッケージ名と実行役（`SequelizeRdsSqlRunner`）だけが違います。

### 1. データソースを定義する

```ts
import {AthenaClient} from '@aws-sdk/client-athena';
import {
    TypeOrmRdsSqlRunner,
    createBiDataSource,
    readBiQueryConfig,
} from 'bi-dwh-query-for-typeorm';

const config = readBiQueryConfig(process.env, {
    engine: 'BI_QUERY_ENGINE',
    athenaWorkGroup: 'BI_ATHENA_WORKGROUP',
    athenaDatabase: 'BI_ATHENA_DATABASE',
    athenaCatalog: 'BI_ATHENA_CATALOG',
    rdsRetentionDays: 'BI_RDS_RETENTION_DAYS',
});

export const salesBiDataSource = createBiDataSource({
    id: 'sales.aggregation',
    config,
    rdsRunner: new TypeOrmRdsSqlRunner(dataSource),
    athena: {
        createClient: () => new AthenaClient({region: 'ap-northeast-1'}),
        // RDS でスキーマを修飾しているテーブルを、Athena のデータベースのテーブルとして読む
        schemaAliases: {aggregation: config.athena.database ?? ''},
    },
});
```

- 環境変数の名前は、使う側が決めます。
- 不正な設定は、その環境変数の名前を付けて例外にします。不正な設定とは、未知のエンジン、athena なのにワークグループかデータベースが無い、保持日数が正の整数でない、の3つです。
- 設定のエンジンが `rds` のときは、Athena のクライアントを作りません。
- `id` はエラーとログに出す名前です。

### 2. 集計を書く

```ts
import {BI_PERIOD, biSqlDate} from 'bi-dwh-query-for-typeorm';

const rows = await salesBiDataSource.select({
    period: {from: '2026-10-01', to: '2026-10-31'},
    params: {from: biSqlDate('2026-10-01'), to: biSqlDate('2026-10-31')},
    sql: (dialect) => `
        SELECT f.system AS "system",
               ${dialect.countDistinctPair('f.access_date', 'f.user_id')} AS "userDays"
        FROM aggregation.access_logs f
        WHERE f.access_date >= :from AND f.access_date <= :to
        GROUP BY ${dialect.groupByColumns([{expression: 'f.system', alias: 'system'}])}
    `,
});
```

- `period` で実行先が決まり、そのエンジンの方言が `sql` に渡されます。
- エンジンで書き方が違う箇所は、方言のメソッドを使います。
  - 方言はエンジンの名前を持ちません。呼び出し側でエンジンを見て書き分けないでください。
  - 方言に無い書き分けが必要になったら、方言にメソッドを足すか、どのエンジンでも動く書き方を探します。
- 日付・日時の値は `biSqlDate` / `biSqlTimestamp` で渡します。
  - Athena は、日付の列と文字列を比べると型エラーになるためです。
  - RDS へは、素の文字列に戻して渡します。
- 配列の値は `IN (:ids)` で展開されます。空配列は `NULL` になります（`IN (NULL)` は何にも当てはまりません）。

## SQLの書式

SQLは、RDS の書式で書きます。Athena で実行するときは、核が Athena の書式へ変換します。

| | MySQL | PostgreSQL |
| --- | --- | --- |
| 識別子 | `` `name` `` | `"name"` |
| パラメータ | `:name` | `:name` |
| Athena への変換 | `` ` `` を `"` にする | そのまま |

- パラメータは、Athena ではエスケープしたリテラルとして埋め込みます。文字列リテラル・コメントの中は変換しません。
- `schemaAliases` に書いたスキーマで修飾したテーブル（`aggregation.t`・`` `aggregation`.`t` ``・`"aggregation"."t"`）は、Athena のデータベースのテーブルとして読み替えます。
  - 囲まずに書いた修飾も読み替えるため、**スキーマ名と同じ別名をテーブルに付けないでください**（`FROM t aggregation` と書くと `aggregation.col` が読み替えられます）。
- PostgreSQL の `x::date` のキャストは、Athena で使えません。`CAST(x AS date)` で書いてください。Athena へ変換するときに見つけると例外にします。

## Athena で書くときの注意

- SELECT の別名は GROUP BY に使えません。`groupByColumns` を使います。
- `date_diff('day', …)` は日時を渡すと時刻まで見て数えます。日時は `asDate` で日付にしてから `dateDiffDays` に渡します。
- 2段に相関した副問い合わせは使えません（`Given correlated subquery is not supported`）。外側を参照する副問い合わせの中で、さらに外側を参照する形がそれに当たります。対象ごとに集計した派生表を外部結合する形にします。
- 型の無い `NULL` は AVG などに渡せません。`asDouble('NULL')` のように型を付けます。
- 整数同士の `/` は整数の割り算になります（PostgreSQL も同じ）。小数にしたいときは `asDouble` を使います。
- 並び順を決めたいときは、同じ値の行も順が決まるように ORDER BY を書きます。エンジンで並び順が変わることがあります。

## PostgreSQL で使うときの注意

- PostgreSQL のドライバ（pg）は、`bigint`（`COUNT(*)` の結果など）と `numeric` を文字列で返します。MySQL と Athena は数値で返すため、エンジンで値の型が変わります。
  - 数値で受け取りたいときは、使う側で `pg.types.setTypeParser` を設定するか、受け取った後に `Number()` で変換してください。
- `PostgresDialect` の各メソッドは、MySQL の方言と同じ結果になるように書いています。実際の DB での確認は、bi-dwh-query-for-typeorm の結合テストで行っています。

## 実行役を自分で書く

TypeORM・Sequelize 以外の部品で RDS に接続するときは、`RdsSqlRunner` を実装します。

```ts
import {RDS_DATABASE_TYPE} from 'bi-dwh-query-core';
import type {RdsParams, RdsSqlRunner} from 'bi-dwh-query-core';

export class MyRdsSqlRunner implements RdsSqlRunner {
    readonly databaseType = RDS_DATABASE_TYPE.MYSQL;

    async select<Row>(sql: string, params: RdsParams): Promise<Row[]> {
        // :name の名前付きパラメータと、配列の展開（IN (:ids)。空配列は NULL）を、使う部品の書き方に変えて実行する
    }
}
```

- `databaseType` で、方言と Athena へ変換するときのSQLの書式が決まります。
- 値が無いときは、空のオブジェクトが渡されます。
- 書いた実行役は、契約テストで確かめます。

```ts
import {RdsQueryEngine} from 'bi-dwh-query-core';
import {defineBiQueryEngineContract} from 'bi-dwh-query-core/testing';

defineBiQueryEngineContract('MyRdsSqlRunner', {
    createReturning: (rows) => new RdsQueryEngine({runner: /* rows を返す実行役 */}),
    createFailing: (error) => new RdsQueryEngine({runner: /* error で失敗する実行役 */}),
});
```

## テストで使う部品（`/testing`）

| 部品 | 用途 |
| --- | --- |
| `renderRdsQuery(query, databaseType?)` | 問い合わせを、RDS の実行役へ渡すSQLと値にする |
| `renderAthenaSql(query, {schemaAliases, sourceSyntax})` | 問い合わせを、Athena で実行するSQLにする（AWS には接続しない） |
| `defineBiQueryEngineContract` | `BiQueryEngine` の実装の契約テスト |
| `defineEngineSelectionPolicyContract` | `EngineSelectionPolicy` の実装の契約テスト |

## 開発

```bash
npm install
npm run typecheck
npm test            # node --import tsx --test（Node 20 以上）
npm run build       # dist を作る（CommonJS の JavaScript と型定義）
npm run format
```

- `dist/` はコミットしません。git の依存として入れたとき、`prepare` でビルドされます。
  - ビルドは `tsc` だけで行います。使う側の CI が Node 16 でもビルドできるようにするためです（TypeScript 7 は Node 16.20 以上で動きます）。
  - devDependencies は使う側の `npm install` のたびに入るため、増やさないでください。
- 実際の DB での確認は、ORM のパッケージの結合テストで行います。

## 版の出し方

1. `package.json` の `version` を上げてコミットし、`v<版>` のタグを付けてプッシュします。
2. ORM のパッケージの、この核への依存のタグを上げて、それぞれの版を出します。
3. 使う側は、ORM のパッケージのタグを上げます。
