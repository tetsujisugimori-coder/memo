# ?????????????

????commit 53445474028601131136e2bc540ee48aee83cd7a / tree 0a9f3bf1d88c035a33ed46efbda4e79207aa378e???????owner?sourceMs?????????????UNKNOWN?last??????ID?????????????????????????Worker?getAll request_success??message?owner/??ID????????

## webkit A

runId 931b521f-c38c-4999-ac06-6018ec702f16 / DB idb-lifecycle-0f99b403-d16a-4096-bcdb-28a7cc781c0f / browser 26.5

|connectionId / version|??ms|???????ms/event|close_called ms|close_returned ms|transaction??|
|---|---|---|---|---|---|
|main/c1 / v1|21|22/close_returned|22|22|main/tx1:transaction_complete@22|
|main/c2 / v2|22|23/close_returned|23|23|main/tx2:transaction_complete@22|

## webkit B

runId 3bd31398-ab83-40f7-9d1a-eb04f78fd899 / DB idb-lifecycle-c86d6cfb-12b0-44ca-9c29-5ab510be9ed4 / browser 26.5

|connectionId / version|??ms|???????ms/event|close_called ms|close_returned ms|transaction??|
|---|---|---|---|---|---|
|main/c1 / v1|22|23/close_returned|23|23|main/tx1:transaction_complete@22|
|main/c2 / v2|23|23/close_returned|23|23|main/tx2:transaction_complete@23|

## webkit C

runId c93acf92-b955-428f-99e6-cd6cf5671dd2 / DB worker-poc-3eccaf66-deb9-45f1-ad7d-85a62e850276 / browser 26.5

|connectionId / version|??ms|???????ms/event|close_called ms|close_returned ms|transaction??|
|---|---|---|---|---|---|
|main/c1 / v1|57|59/close_returned|59|59|main/tx1:transaction_complete@58<br>main/tx2:transaction_complete@59|
|main/c2 / v1|60|63/transaction_complete|62|62|main/tx3:transaction_complete@63|
|main/c3 / v1|62|63/transaction_complete|63|63|main/tx4:transaction_complete@63|
|main/c4 / v2|64|64/close_returned|64|64|main/tx5:transaction_complete@64|
|main/c5 / v2|64|65/transaction_complete|65|65|main/tx6:transaction_complete@65|
|main/c6 / v3|65|66/close_returned|66|66|main/tx7:transaction_complete@66|
|main/c7 / v3|66|67/transaction_complete|66|66|main/tx8:transaction_complete@67|
|main/c8 / v4|67|67/close_returned|67|67|main/tx9:transaction_complete@67|
|main/c9 / v4|67|68/transaction_complete|67|67|main/tx10:transaction_complete@68|
|main/c10 / v5|68|68/close_returned|68|68|main/tx11:transaction_complete@68|
|main/c11 / v5|68|69/transaction_complete|68|68|main/tx12:transaction_complete@69|
|main/c12 / v6|69|69/close_returned|69|69|main/tx13:transaction_complete@69|
|main/c13 / v6|69|70/transaction_complete|69|69|main/tx14:transaction_complete@70|
|main/c14 / v7|70|70/close_returned|70|70|main/tx15:transaction_complete@70|
|main/c15 / v7|70|70/transaction_complete|70|70|main/tx16:transaction_complete@70|
|main/c16 / v8|71|71/close_returned|71|71|main/tx17:transaction_complete@71|
|main/c17 / v8|71|72/transaction_complete|71|71|main/tx18:transaction_complete@72|
|main/c18 / v9|72|72/close_returned|72|72|main/tx19:transaction_complete@72|
|main/c19 / v9|72|73/transaction_complete|73|73|main/tx20:transaction_complete@73|
|main/c20 / v10|73|75/close_returned|74|75|main/tx21:transaction_complete@74|
|main/c21 / v10|75|76/transaction_complete|75|75|main/tx22:transaction_complete@76|
|main/c22 / v11|76|76/close_returned|76|76|main/tx23:transaction_complete@76|
|main/c23 / v11|76|78/transaction_complete|77|77|main/tx24:transaction_complete@78|
|main/c24 / v12|78|78/close_returned|78|78|main/tx25:transaction_complete@78|
|main/c25 / v12|78|79/transaction_complete|79|79|main/tx26:transaction_complete@79|
|main/c26 / v13|79|79/close_returned|79|79|main/tx27:transaction_complete@79|

## webkit D

runId eec76e89-5f10-45d0-8830-8dcb3ddf2110 / DB worker-poc-d12d5caa-4a7d-4223-81c0-0a6cd77a1f74 / browser 26.5

|connectionId / version|??ms|???????ms/event|close_called ms|close_returned ms|transaction??|
|---|---|---|---|---|---|
|main/c1 / v1|31|33/close_returned|33|33|main/tx1:transaction_complete@32<br>main/tx2:transaction_complete@33|
|main/c2 / v1|33|35/transaction_complete|34|34|main/tx3:transaction_complete@35|
|worker-1/c1 / v1|11|11/transaction_start|NOT_OBSERVED|NOT_OBSERVED|worker-1/tx1:NOT_OBSERVED (???UNKNOWN)|
|main/c3 / v2|51|52/close_returned|52|52|main/tx4:transaction_complete@52|
|worker-2/c1 / v2|6|7/transaction_start|NOT_OBSERVED|NOT_OBSERVED|worker-2/tx1:NOT_OBSERVED (???UNKNOWN)|

## webkit E

runId e22b6648-7957-44f7-bb08-a902f835d763 / DB worker-poc-8de8fd09-68f4-436d-8c65-0297dd6436cf / browser 26.5

|connectionId / version|??ms|???????ms/event|close_called ms|close_returned ms|transaction??|
|---|---|---|---|---|---|
|main/c1 / v1|29|31/close_returned|31|31|main/tx1:transaction_complete@30<br>main/tx2:transaction_complete@30|
|main/c2 / v1|31|33/transaction_complete|32|32|main/tx3:transaction_complete@33|
|worker-1/c1 / v1|8|10/cooperative_ack|10|10|worker-1/tx1:transaction_complete@10|
|main/c3 / v2|44|45/close_returned|45|45|main/tx4:transaction_complete@45|
|worker-2/c1 / v2|13|14/cooperative_ack|14|14|worker-2/tx1:transaction_complete@14|
|main/c4 / v3|60|61/close_returned|61|61|main/tx5:transaction_complete@61|
|worker-3/c1 / v3|6|7/cooperative_ack|7|7|worker-3/tx1:transaction_complete@7|
|main/c5 / v4|68|69/close_returned|69|69|main/tx6:transaction_complete@69|
|worker-4/c1 / v4|5|7/cooperative_ack|6|6|worker-4/tx1:transaction_complete@6|
|main/c6 / v5|76|77/close_returned|77|77|main/tx7:transaction_complete@76|
|worker-5/c1 / v5|7|8/cooperative_ack|8|8|worker-5/tx1:transaction_complete@8|
|main/c7 / v6|86|87/close_returned|87|87|main/tx8:transaction_complete@86|
|worker-6/c1 / v6|7|8/cooperative_ack|8|8|worker-6/tx1:transaction_complete@8|
|main/c8 / v7|96|96/close_returned|96|96|main/tx9:transaction_complete@96|
|worker-7/c1 / v7|5|6/cooperative_ack|6|6|worker-7/tx1:transaction_complete@6|
|main/c9 / v8|103|103/close_returned|103|103|main/tx10:transaction_complete@103|
|worker-8/c1 / v8|6|7/cooperative_ack|7|7|worker-8/tx1:transaction_complete@7|
|main/c10 / v9|112|112/close_returned|112|112|main/tx11:transaction_complete@112|
|worker-9/c1 / v9|5|6/cooperative_ack|6|6|worker-9/tx1:transaction_complete@6|
|main/c11 / v10|120|121/close_returned|120|121|main/tx12:transaction_complete@120|
|worker-10/c1 / v10|5|7/cooperative_ack|7|7|worker-10/tx1:transaction_complete@7|
|main/c12 / v11|129|129/close_returned|129|129|main/tx13:transaction_complete@129|
|worker-11/c1 / v11|5|7/cooperative_ack|7|7|worker-11/tx1:transaction_complete@6|
|main/c13 / v12|137|137/close_returned|137|137|main/tx14:transaction_complete@137|
|worker-12/c1 / v12|5|7/cooperative_ack|6|6|worker-12/tx1:transaction_complete@6|
|main/c14 / v13|144|145/close_returned|145|145|main/tx15:transaction_complete@145|

## chromium A

runId df55a748-0e2a-43a3-ac40-0a939ad07a29 / DB idb-lifecycle-23e63935-534b-4c9d-a374-84dff5efdc50 / browser 151.0.7922.34

|connectionId / version|??ms|???????ms/event|close_called ms|close_returned ms|transaction??|
|---|---|---|---|---|---|
|main/c1 / v1|24.60000000000582|25.39999999999418/close_returned|25.39999999999418|25.39999999999418|main/tx1:transaction_complete@25.19999999999709|
|main/c2 / v2|25.80000000000291|26/close_returned|25.89999999999418|26|main/tx2:transaction_complete@25.89999999999418|

## chromium B

runId f5aa38f8-7bf9-4bae-b48c-3917c827efaf / DB idb-lifecycle-8a35223f-f119-42cf-a50a-1a31b339b2ed / browser 151.0.7922.34

|connectionId / version|??ms|???????ms/event|close_called ms|close_returned ms|transaction??|
|---|---|---|---|---|---|
|main/c1 / v1|23.80000000000291|25.30000000000291/close_returned|25.30000000000291|25.30000000000291|main/tx1:transaction_complete@24.39999999999418|
|main/c2 / v2|25.59999999999127|26/close_returned|26|26|main/tx2:transaction_complete@26|

