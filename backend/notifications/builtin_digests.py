"""Digest of every built-in email body this repo has ever seeded.

Generated file -- do not edit by hand. After changing brand_templates.py run:

    python manage.py sync_email_templates --record

A row in `email_templates` whose (subject, body_html) hashes to one of these is
a seed nobody rewrote, so builtin_sync.py may refresh it from the current copy.
Digests are only ever added: an environment can still be sitting on any older
revision. See notifications/builtin_sync.py for the why.
"""

BUILTIN_DIGESTS: dict[tuple[str, str], tuple[str, ...]] = {
    ("hq.new_school_registered", "de"): (
        "fa59d6814337c2fed83baa03373eb7bc818a22229f84475cfe178f9b94bd3038",
    ),
    ("hq.new_school_registered", "en"): (
        "6e42d9fd967abedab5058bcd36f362c90be515cf37b59254d7c3aeca323dd6e7",
    ),
    ("hq.new_school_registered", "es"): (
        "998b6bb123a88fb2de43196bc0f324eb6c2808e6582a4f3640bc3c0b2d143d06",
    ),
    ("hq.new_school_registered", "fr"): (
        "17857a4a45a4236871e437fbdd950bd1ef60a6949b9cbe59c5570efda4fdc949",
    ),
    ("hq.new_school_registered", "it"): (
        "b989461f98a34b5b6d818d6e5f096097b1777fae1360a9323186fef45cc8c7e2",
    ),
    ("hq.weekly_kpi_report", "de"): (
        "6fd03d58c964487d8f5e42ad160a9568a43d3079401b35d4acd60cc4f4b89fb0",
    ),
    ("hq.weekly_kpi_report", "en"): (
        "37c7c7661b372e59637f0bf022e83427950ef639e4b7d2ead617d47666facdde",
    ),
    ("hq.weekly_kpi_report", "es"): (
        "2f5e88752a641028f109e8c81d70271f38505337f75e55313bd36a76697054f0",
    ),
    ("hq.weekly_kpi_report", "fr"): (
        "895d40a8f4a0cbe13802db6b31ec9d88dd217c45fe0c68aafee8657f2436d859",
    ),
    ("hq.weekly_kpi_report", "it"): (
        "0f2109add9ea42c69399cf5780959234ce5d02ff7a0100d68ec645613fb3a3fa",
    ),
    ("password_reset", "de"): (
        "772b31ca5f5f2aedd826cbfa11d30f70c827a3642ecf55f9f8376d3be4405ca8",
        "e86eb929e23251308900a4ca3ff25c5ed6522353e36133b43fc2f33f0db3107a",
    ),
    ("password_reset", "en"): (
        "2ce587d50a7421cc2f1db37b47900ea52d5bfaa2b6b74ee7dd5bb86c88a070ad",
        "c98b1597cb437c8346e82f6142447e0268737d36c5a9b9de7483eaf30cfe8ffa",
    ),
    ("password_reset", "es"): (
        "af693813fa84c78045f2107e7226e65757b02dceca93a08c2c0c0298158090a6",
        "b71588364f72e8c26c425e1c487dbabb493b2a436c23b70d5ff227c827a45448",
    ),
    ("password_reset", "fr"): (
        "0037ba7f1a2c25220bfab19e2d8d44fc81701d431b568268530675cfad351665",
        "f705745119a8e73c3c51512a5edfd596612fbfdbc4dd6e0c2c8c94e5bd2b6cff",
    ),
    ("password_reset", "it"): (
        "0f8901a2421c800274e12bf0d12b09beb2b42090ca00aca20ba21dc1d13ce047",
        "f49104407611187158bbbf51771190ef7f4b6dfe82c7c29272a59818251ce2d9",
    ),
    ("school.booking_cancelled", "de"): (
        "fb628b0f4f2d17d4ecdea0cb1826abb25ce1c41fbb4d5d6c05dbd0a19c07194d",
    ),
    ("school.booking_cancelled", "en"): (
        "f2530014cf151a08af18a17b3dd35de150b1cf0649eb33c04cde4376c1d90dfe",
    ),
    ("school.booking_cancelled", "es"): (
        "009b69a00afc058e5a247bf3dc9cc06d881dc577c002bab5e56176d0519c2e39",
    ),
    ("school.booking_cancelled", "fr"): (
        "2156c9b30b62e169bd4cb0b45a517c88cb0fba2a55b079bca77b292003f13707",
    ),
    ("school.booking_cancelled", "it"): (
        "a47887d96984ac0d57a0b00c44deb551da006015af3a8719f45447452bb83c0f",
    ),
    ("school.new_booking", "de"): (
        "745ed0f550f87cafa4348f37922ce51df3eabdda72571505d226880bbb320c07",
    ),
    ("school.new_booking", "en"): (
        "2f234e709fa79197c949ee6e99c9faccf4194e3049cb734088f8b6d921d939a6",
    ),
    ("school.new_booking", "es"): (
        "7736e7ad65c74a5a8b9061e110b754c07a7d39df5011728aee2fdea992bf97de",
    ),
    ("school.new_booking", "fr"): (
        "8bb626d23cbf970234ff492519b1e3e45fc8b8f96952b2014118cffb013b368e",
    ),
    ("school.new_booking", "it"): (
        "3ade1f77b18a8c1cb8795167133954a0cdabb1cc5826ce9b4ae6a9041da2a919",
    ),
    ("school.stripe_connected", "de"): (
        "c161c00897ead156c57f64064c30d7d605828d03ca012faedb390ced35cdc7c4",
    ),
    ("school.stripe_connected", "en"): (
        "f31f6ff2394c9d4318aa59c459512f07798121ae7248b711002e541c106c2a80",
    ),
    ("school.stripe_connected", "es"): (
        "d1b19446a440b55946fb56e2ac256507b3c8a2ef9b6a4206fcd430e3826fb711",
    ),
    ("school.stripe_connected", "fr"): (
        "10b6ea201c35eddfcfae4cac1093993bdcf9ec480e52d62ef7151517143ec3bf",
    ),
    ("school.stripe_connected", "it"): (
        "ef5999d26764490da82c8d33f17d9060bc66fa0ed65b5990dd213c69aa2ee330",
    ),
    ("student.account_deleted", "de"): (
        "a6bef6aed2ea8413dff483dada39073a3f2b4d203879430e318fac3e5f325a38",
    ),
    ("student.account_deleted", "en"): (
        "2e597cbd8aadfb0e81a2fae56b386483d1c55ded9669be19837465f6a5d95ba2",
    ),
    ("student.account_deleted", "es"): (
        "f0a12ab1dbd1cd3d7b7fbdcb96099412c98c58c8afc3d463a588e5cd9626555d",
    ),
    ("student.account_deleted", "fr"): (
        "15eb4987590d162da26c5d4588562b833571a586441ec63247a6de8dc3af6d9c",
    ),
    ("student.account_deleted", "it"): (
        "6ccb519d0b92cdd4ff7e6974491a98615c48a6f3c36f489feec02d8b07874e48",
    ),
    ("student.account_deleted_by_school", "de"): (
        "0470d1c1db8ef379de4fb01b09f5193950591bc82d9717457809ec0e99a21955",
    ),
    ("student.account_deleted_by_school", "en"): (
        "d8648d292d2c3ed627fe636ccd674a53f0fd817bf9e766f0bda424e7bd480385",
    ),
    ("student.account_deleted_by_school", "es"): (
        "4413b8a4948a8cbf1cd2a5af093cce43ab2e9c6655184ffb1a5ae1cdc878b7d5",
    ),
    ("student.account_deleted_by_school", "fr"): (
        "85084bb93e5275b946ab7446adac75b7832f05ad460543b068561943a5512b40",
    ),
    ("student.account_deleted_by_school", "it"): (
        "852521838526ea3326553e2c37ef98c2cbb35d597fb538d8555b70b4a0ad7b11",
    ),
    ("student.after_purchase", "de"): (
        "c8ba06c21b3070c9a2f25af33f22ccfcf51ee385758a9f17f6529a4d2241208c",
        "f978d695f587167190651c033247fd95468de003b8811553e589608bbd51c9f2",
    ),
    ("student.after_purchase", "en"): (
        "45376b9efd300a9a2e64675d77632b49fd91532df1391f70fcf6e541cacc8406",
        "917c5f3a648edd9a46de0b8486740c7234946236c1324a2df4e77e0bd7bbf728",
    ),
    ("student.after_purchase", "es"): (
        "a1bd38dad867aa889eb02fccd7167ef115f22956ce956622a856916c87bfd427",
        "c1c065a1e7e7d1ef34f1d92cdc389ef2b752a26c3e435f7eb1369f2cd713a1e8",
    ),
    ("student.after_purchase", "fr"): (
        "0d11c4fc31b614022e7da186f7d2d409475372d8a50a77e829288f8e737eaddc",
        "8dd3a30a792864a7e9289f74b87f55889aed8d07093976d061c0f30b624027b3",
    ),
    ("student.after_purchase", "it"): (
        "1db1e89870fd4220bd15c3261e581e9f1a1cc12133e4e13a03f693f08ab6d339",
        "67701c596050e6df4254cf5e9cd19ffe1750025552c1bd91be8d8f1d6bcd4d17",
    ),
    ("student.booking_cancelled", "de"): (
        "d92b449432da06d8f33203fbebd9b08d434b66771eea42ab5cc0f4807c4d3cf2",
        "e5b79e073a975b19405a87015f514e97eabe698b57b62b55d44dc5923e66d8f8",
    ),
    ("student.booking_cancelled", "en"): (
        "1b98c67dc0360c4596e3f9bde055d9dd99732900461971c3b9feed1b544cc138",
        "5da67647e6f5d8f2635bfcc1d89260cce917454df2a9f32823cda3f7b7666b1e",
    ),
    ("student.booking_cancelled", "es"): (
        "4f9a0426aeffe56f11b553ec193c6147c31cb711a3198b410d2cff6aa8142d7e",
        "bfcd9aff115ef600d05e070f330e2e753e59b01bd442698649dfdd7731b3fb46",
    ),
    ("student.booking_cancelled", "fr"): (
        "0f8666dcbbf81e072ceaae7ef6be36d754230505787b8e50fde7dae395f906c8",
        "4aa7c8c6d17b2484fa705aaf636cd41928c2a1a3095c3155d5b3c3d0284f4f92",
    ),
    ("student.booking_cancelled", "it"): (
        "da7d2d16526e7d3073079aded9e5c899bbb5450c680b48f20e4a3b70c8067400",
        "dbc2f461d98b080e48ad46cebaf881dc1cb3d6bbffbb7a33daf90d3c79162c6d",
    ),
    ("student.booking_cancelled.online", "de"): (
        "2b24ffb752edcbb68ede7a98a53f6fc89bef2114504e69d573e396c44611764a",
    ),
    ("student.booking_cancelled.online", "en"): (
        "93b2993b9f4a87322c04eaea002e56061c1fc04f9e1b960936c48bd7074a14bd",
    ),
    ("student.booking_cancelled.online", "es"): (
        "653a24eec548c99da3719f1bf5b1a4568c213b06831045eb420f28e177b3031c",
    ),
    ("student.booking_cancelled.online", "fr"): (
        "a576bf1d70225263eed6ee6b9409b17701208e47dfc14956616676fe37c2ddcc",
    ),
    ("student.booking_cancelled.online", "it"): (
        "e892730e3f4b3b9876f1b682fcb444e0cfff3b7c5e22b3eba7c77828647f0151",
    ),
    ("student.booking_confirmed", "de"): (
        "2c0c53a6d9252ab057ac52ae15453a47dc7d56ce613a9fdefbf51795be43ba13",
        "9a5241c2aec338038e39ec262399a381e766e5f3ce28d90965c80d65bee26cd0",
        "ae8b3b6741129f28b578e2c03155680e6252d114257ef7c6ece0be944a64f345",
        "b0853cf0011c31af5b01c392e4067a2c07461839880df41b1167553dd78fd1f1",
    ),
    ("student.booking_confirmed", "en"): (
        "291a8df9883055594fa05f602c2a70423d11c86a2f8b5b10d2fa2b486fe7549e",
        "89a5e6ed6a1e014296107db9f2dcf9f93c2994115a4008c4b1b47f5f50833b1b",
        "8f1a228a8d8b4315f953c9b397762171f45ef879147210f717d94e0cbdf6d20b",
        "e650cf8c2c6308ccb46076aeaa73216a270a37bca459e4ed394d0e1fa271777e",
    ),
    ("student.booking_confirmed", "es"): (
        "292dbcc3e0f6b6f5db0196a9e8596cc9ed1dd375827dfbb1b47e1bdee30edf69",
        "2f77ba000b85332ceadff36daf19b152c66b3c4f0eb67a94a85f90b704f522f2",
        "36026c834506730d9f67235f7dc5e47fcf8bdd050f7e546099d8b56929595f6d",
        "5911bcf203537db49e783a70fa172f247995e961d7e3ecb620c3d36718fa028e",
    ),
    ("student.booking_confirmed", "fr"): (
        "0a8ba0b9d582cd2984c048ad2f490ba0426862f501707ab847edddcaddaeb6bb",
        "0de41442bc2f7f70bc29999845687894d00a058cf5796dc62c16f8c9b56c9c24",
        "9504ec9e528ea1e74068c6868ba1fbd954c19f097020a078ff6e13d873819521",
        "acb2ebe0d0a37b4f81534379d894b489bb5f7a136176f87f0d5a0e641b35e124",
    ),
    ("student.booking_confirmed", "it"): (
        "672cf5bf45c3e026c5ebdaa98c770c24abe176b738c9716438f3311c32ba5a44",
        "7949d96a0f9c69462bb6bec67663fc057846d442fa8c6991bff4b6dd3a972883",
        "ac2fb3b728932c04b62541fff8273a3eeebfe37c1f68f86e73d30618b39971a0",
        "d3f0124dca2bcbc197614cabb2ca68110d158449a11123a313c81cf79c825f57",
    ),
    ("student.booking_confirmed.online", "de"): (
        "5fa50aa9597fdca655a0e5520efcf389cdf16db06a19e84dede8dc148b57eaba",
        "a5dae80be923a271486e287e7baa4df2325a475ca5eacf9a898a7ba4f1493b9e",
        "f438836d512b81741e2ee981392c10fd4bd0dddb51f877a961c8e2a5f0ea56fa",
    ),
    ("student.booking_confirmed.online", "en"): (
        "153bcbc62689e32f9136f9f9e0b39517979708f162ad948a5ace44444f8aa136",
        "5b5ac1d2828cf2c29296df53719c6cec4a0ccb1d2fa6dccf524ad5e7cb3b3a6e",
        "f680eca720fd4069414e68007531b5ab2625f661c41430c1ad1538a90e3a2b37",
    ),
    ("student.booking_confirmed.online", "es"): (
        "7428827690eb4f7bb98f4cd416542ca0082bf1d5dc508c8ad5a8d0f92b42c163",
        "7c3db849b59a255598c938bbdb222ef45fbfc5e455f46669e00174c311b73c3f",
        "d0e570d934cf213d46a7130256c15938f1daaded16376fdbc5b712ccd67e9acd",
    ),
    ("student.booking_confirmed.online", "fr"): (
        "006a2fcb68ab7c62a50557f0fc7aa4a5aed79dcf846316ca4497a8282eb6ed5e",
        "b1feaaa46e75271ded289651b6382f3ec9b4a616932c7b18722d9307b34b91a0",
        "f07d9c6667838f79804f553228783587663becb82fa0e2ecb4e6704436becfab",
    ),
    ("student.booking_confirmed.online", "it"): (
        "1b55ba4498dd475bd8666dfe86780835ba47b1f648f7874c2c3d44700a5e0734",
        "6fd0285c69bd5732a645271864bf55350f30c9f526da5fa27737d99ab5878a7c",
        "850b4a861dcc24f3c961fd45f419a6c2e8299fe6db6f6b70991506638cd07847",
    ),
    ("student.credits_low", "de"): (
        "777b512d42104cdc6fb351149b61c5f80deb85b496f7530a5aebb31cc90904d1",
        "7a70924a3dbbd82f01eb6c57f763d41cb7bc221b3e8778c760d9d81b04098a93",
    ),
    ("student.credits_low", "en"): (
        "974e0c87e06785e9c4fbade5c0a55abd9e50be405a07416246734ab9de0cd4f5",
        "d7e5b74e599830cb527314e7407929db47fae218cfee77dd4c8eccf32832b438",
    ),
    ("student.credits_low", "es"): (
        "9e3249d2c3cf70847faa1ee1b5bcddf9afc3318a9a7d89cc340740ed98c3cc24",
        "a294dac0fa4e3b9688b41ba8f128e4070a3b5135770454950e2ec2a5d3f83c21",
    ),
    ("student.credits_low", "fr"): (
        "1e4f71080c7d3c5b110b31ea8fda803c10a17f7f22df4f027600a483231ed1e8",
        "6e3ccb34cab3c167d516ce6f08b4e4aa3bd69e66b780440278992d16d220d49c",
    ),
    ("student.credits_low", "it"): (
        "1b0b599958589bb6b8703a434252116e8bcdba5e50e9d84edb6ab90b04928607",
        "911e2cd3545d3d73cf69348883ce885649c73d90eb595e6452ce08add386f1cc",
    ),
    ("student.document_expiring_30", "de"): (
        "303fb3108e20703b24b8ac06959cc09158473f5ae320eeb85b5d53570a3b4e89",
    ),
    ("student.document_expiring_30", "en"): (
        "1f3b52ec42c402939c66ed4fe9a0cd8360bfc362d194e45eab10fdad65f01d46",
    ),
    ("student.document_expiring_30", "es"): (
        "dea52dd40b7d0343c261b318f0a60b3a8aabeb6ef7b7330b53721a5daf0725c1",
    ),
    ("student.document_expiring_30", "fr"): (
        "428916d55fb58fc33e71b177211231b134f8fe171a9f30db148270c42f0388cf",
    ),
    ("student.document_expiring_30", "it"): (
        "4c4a6416ac743851fe1fb0a997c16935b2631ae6f363bcb5d2a69a94d59647b3",
    ),
    ("student.document_expiring_7", "de"): (
        "ce57008fa83789df83ceb55f97174da227acf64c37c376196b3542d92132bbfc",
    ),
    ("student.document_expiring_7", "en"): (
        "16a18cc9935102296ae26a60ce1f982d95d441a2bf8ac17534d3672aae298efd",
    ),
    ("student.document_expiring_7", "es"): (
        "b77e35d413c1e9702a700e60a2f7f11cdda717337172e42f50dec5f598c8d2b4",
    ),
    ("student.document_expiring_7", "fr"): (
        "664fca3fde174c73ce48cb347eba61c87e90e1e45d0373643edee8a779cc6f7b",
    ),
    ("student.document_expiring_7", "it"): (
        "0813868aac3d96f8fd45718cf4c4ad2405f42e5a92f0edee6ac50461ec4e9b5e",
    ),
    ("student.lesson_cancelled_by_school", "de"): (
        "06e055022ec3837e6322bef804be47066af9cd6a8e776a22474cdabb0eaafa65",
        "eb62e211d337847a9180f1622b6294c2717b4a8eb1143676a438eb3e991e93fa",
    ),
    ("student.lesson_cancelled_by_school", "en"): (
        "8cd5456377df5027997c13489b1d7591be8dcc9007e2a06778dd34a80230b5cc",
        "f31ac639b0e5691cd4362d38b343379d70d64c543d8c185d10de5b4b8bf38034",
    ),
    ("student.lesson_cancelled_by_school", "es"): (
        "3edb09262663cbf63373dc784b990220ddb14b012a48643a4c78c93aa0f16e77",
        "924c4e7db56635a9c7968dcc2f2b7d023c31ec3a3f43c2af904878704377cbaf",
    ),
    ("student.lesson_cancelled_by_school", "fr"): (
        "bb6b3e2a639e3f82aba36182c69e19334e37008762979ede239a2b5e80bd129e",
        "fe964b8ed2a06918afbdb3f73e12e68d3d7ce98b9830c3301c4183d93f3a0d80",
    ),
    ("student.lesson_cancelled_by_school", "it"): (
        "c69c134f3e8be8cd8fa3cd4e931b088c65f0c84340ecfcde1847c418cc8373b8",
        "f3ca224c667889074d8d53e1534fd7d24939bdf77a6c1ddbc9bd0db80435117f",
    ),
    ("student.lesson_cancelled_by_school.online", "de"): (
        "abf258465899e3bc4455fd97596e0f3c50ad7ce94d4c0321ce989e0ed49d73f5",
    ),
    ("student.lesson_cancelled_by_school.online", "en"): (
        "dad2e28ec46eb774cfefc2c3475a857987434c522e0a4cb166e883adb7dad0a2",
    ),
    ("student.lesson_cancelled_by_school.online", "es"): (
        "399ad642445aced556a132f6debbfbba6895858228d2e28ab9b1b5904dc0cd5c",
    ),
    ("student.lesson_cancelled_by_school.online", "fr"): (
        "8367335a9cdbf2135255f3e8f5af907463c2fbcbb1c931e82b23149054be93ec",
    ),
    ("student.lesson_cancelled_by_school.online", "it"): (
        "e381b1d4906b4a5774e96f2369307514343a6b180b54d5061c300903b4606cfd",
    ),
    ("student.lesson_reminder_1day", "de"): (
        "3ef2b65201b12466b561719c253861dd87884946a5765839934f49f7539493c0",
        "950a5d2beb589899b88d3c4a99d05d6a0074b819092852d96010828df4906c3a",
        "f2aef3803338a045ae7bde52a63b6b576c91c7414148d11f9341b96ca648cf86",
    ),
    ("student.lesson_reminder_1day", "en"): (
        "08341932cb42571eb04f46cba0fb636584573a0da50eb3bc6c9d56bd297dc29d",
        "44e40faa38eccd1a956b7c7b3a8b71f147b0942027d6a139510d7026618699f8",
        "d62817ae4bc218a86483ba30f8845a8d41c22d44b9fc6d2639767dae5e475fc2",
    ),
    ("student.lesson_reminder_1day", "es"): (
        "063af2f55ea2de20f708401cb4b804acb1f50f3678a568018ce70ddf98c1bcb9",
        "1d0e4104afc4f94b789c32335d2aecbdceeaa5350501333546e298dc0f1c4427",
        "4cbc228773984aa3b2a338ea9d469c4b660426d063e4edfd4a7040ed6c0ca531",
    ),
    ("student.lesson_reminder_1day", "fr"): (
        "032f66803f2bc071d643813b8971147fb08901dbd5f54fb6d7405ba8128306b7",
        "3c2225093c28a9650ac5a27aa2c2fad0059c21e5b9519e97211ce42407fe188c",
        "8904b8c82ec78acf09836b5ef636f7035d716728bfc08bead049491d1d3566a7",
    ),
    ("student.lesson_reminder_1day", "it"): (
        "69fac35b24ad8510ab5d81a32925941861043ccd5e8f8eb9340adb7166be222b",
        "a60f3b20ff3bd696082b4cefdf7b4d40921b9e654235240468b6c06bded6ca3b",
        "f2a6a6a1bfb9ab434687c509c3d3a7933902f2a63af41f5ea362fc6c9eca2075",
    ),
    ("student.lesson_reminder_1day.online", "de"): (
        "36367181659c00a03a314e572a31e749d8c181602651da1c0eeef95d8443435a",
        "a53b083d0e372135aefa9ef61d7b4ec6d411c3480bab6304c396e4b917e4479e",
    ),
    ("student.lesson_reminder_1day.online", "en"): (
        "bdc7f77c7c5aa11c059fa966189307dd5d78dcbb67e9da98be9e5d07202a8ad6",
        "be1ab4788ba433e094358fcfb10259025c1fd3a7cf8d67568d4d0b6c13103631",
    ),
    ("student.lesson_reminder_1day.online", "es"): (
        "1e7a86eb2732542877912a01326d3b22193c705ea600f6dfbcfe18e2df93d7fe",
        "469934c6fa1063452647754bee5d2af3f629a7a67c2cebe584d2b0f4a337b5fe",
    ),
    ("student.lesson_reminder_1day.online", "fr"): (
        "04ba25b188997c01f9318093864a48496f2ed88a963b8ec1977010182867e87a",
        "c56ffe9442d04502bfdec2f1a1863425c6fd2b63f8da6885fe2248d992a4a55a",
    ),
    ("student.lesson_reminder_1day.online", "it"): (
        "4047ac8c9cf619a76ffcff6847f5edad2ef58dab183603e0be5eded46a089b6f",
        "dd0ac4b8afa04f55b2beafa3d1910c4f286346be448b18a214faa47dbea8cf7d",
    ),
    ("student.lesson_reminder_2hour", "de"): (
        "821922c0e00103961d777ffa9139fbaccc7e169de9ea71dabd9cf945b8f82b7a",
        "88ad9c3de95ecdb9924b06b10093e8224a20a7b5f2f210688aa720cb92bf16c6",
        "cbf33830c460f0480fa45be7dcb6778abf9e992a6c8c51f5601d5d8718cd68b2",
    ),
    ("student.lesson_reminder_2hour", "en"): (
        "0de95e541f541c985b52cbd5b57e21a993f93c1cfcb8c49966289b837c08a7fa",
        "282341e989a69245675f32bfaf13be2fa5038a156cf583d9c6afd09906b5680c",
        "7be6e9d6897a1a8fb880e8d3a4b4d38a54ce1eae2fc07b24c80f183f888c2f72",
    ),
    ("student.lesson_reminder_2hour", "es"): (
        "107af5673d72b2f137bc297e1bcf34894fd0c41af8f20e52124322d39c63b703",
        "78c04be7def937da4aae1fa9c492265efd8a077b725157b92937a853589701cc",
        "f8c83f9388f0b6ea8a071228b45b8b83518beb396093fcb7e7a5a97faf104b54",
    ),
    ("student.lesson_reminder_2hour", "fr"): (
        "d27fd5b5148d18f3e21c89a9d6b644930450e3e8338fed12e761ac6ee0fb4f72",
        "df7cce1ee73a004d8caa823ad00e2f9733b8cd1dad160d05029405b1883da775",
        "e60a8c242a8b5a0ee710a0be1a2a89e761bc9fb42ca0101faeffc9992b18f028",
    ),
    ("student.lesson_reminder_2hour", "it"): (
        "4147eed76d912202c73adaa832670b2bbec9976f92e74accf146202895482871",
        "918239c6122125aba971c70848029b047c1950d991aaa29f4eb608d70d2f2ad2",
        "f280b12ec5d5df8e7900e918d3d341e3bea022c87e36d081a09738a3bb9b53a4",
    ),
    ("student.lesson_reminder_2hour.online", "de"): (
        "29f5e03ad10a9a2d48787a655e5e1508d150a248ab1f6a8901356f781a5e33c9",
        "b8ea32f38a1d9e56c56528dd90257148163d102a927f1e3110ea3cdab9ca7e38",
    ),
    ("student.lesson_reminder_2hour.online", "en"): (
        "17800c57f636b54d6a0f26c86c2dd2f8508feb60f6194e75175fe80eda9485ac",
        "810c2ff4a7e838ff4123c99d85fe2824d3d6b0377c0e44f75cba28be9c9e6ee5",
    ),
    ("student.lesson_reminder_2hour.online", "es"): (
        "7d8f66dfcd438fa20feac8fef0ce987eddd1b93c608ce298550ee64aad2a3b77",
        "980b7cb8423170e4a30f338e4ceb5db71942fefbe861107e3864519898225f46",
    ),
    ("student.lesson_reminder_2hour.online", "fr"): (
        "7fb52be46bf7ef02e7a2a69c3155eda69a44b7fdcd413b6e110821aeb69b423a",
        "985ade0a66be96df897ab319aa6c2ffd3046cfe660550154121100ec807e17e6",
    ),
    ("student.lesson_reminder_2hour.online", "it"): (
        "d0ab7fb52ed7a05877591211ad59add594ef344cd27afeda4b99bcf127ff1c9d",
        "d1af94a4efdce97aaa5f853e86bd565592be45e887f4363adfa98148b6b7e47d",
    ),
    ("student.no_show", "de"): (
        "779997204619db56f2a7de43ae9990bbb5f6d52d8be6ff756aee5470e5247fcb",
        "f587a12f6f8c7ec60fb979b64f964b456ca52a94943d3ff7867b30d3a99dbb41",
    ),
    ("student.no_show", "en"): (
        "58c50e2756eea369da327a814e2c60b2353c50ede345a5998b0c3220071bacfc",
        "6b89cbe1bc22106ea760ca405c1c3134f552a9d1f724c47362965d96f98d594a",
    ),
    ("student.no_show", "es"): (
        "03743009ce70faee1562f32bad4212fd36dfa4784d8df61c76997c1e6947d852",
        "694fe4be5c63f4217fc4f2bc2ec9e606fc1e2394072e7a591d7076bc4ca01eb3",
    ),
    ("student.no_show", "fr"): (
        "9275819f7304d87536ebc0034c96376a2ce3fae8e49bee73187312dedea61127",
        "c063023886f0e19fda3b6ce4b372cc2dc46bcdba409292a1255865b065b5f18b",
    ),
    ("student.no_show", "it"): (
        "23b535348c4a0991c6f526939f1dbe971daa8fa09f659b6b5c8c608faf1c1076",
        "5ac84cefd6badd6fba937a6407f49e2d79922d9395f69354a5394182914b99ab",
    ),
    ("student.package_expiring", "de"): (
        "2ea2375562771f2398a3d2756ff2e8b1bf8cae39e4096ba241d64774673acdcd",
    ),
    ("student.package_expiring", "en"): (
        "368d0654922872c56d662a1fec6a4c897d450b7760fb4f6e795cf9cc767a9049",
    ),
    ("student.package_expiring", "es"): (
        "6664eac059080ba0ad343f5844b1b1d7c58ae80e785d5cd057811b1d2e51f017",
    ),
    ("student.package_expiring", "fr"): (
        "95a5b967f75d6f9482f59d5af453000be817b37da3bb3078cfd4e823e6066a05",
    ),
    ("student.package_expiring", "it"): (
        "5ba010ce95a9e1284dd29c345c23ea8838bf7f72f4674b84bf8d84edff8acf96",
    ),
    ("student.shop_order_confirmed", "de"): (
        "25144790a0b7c23898b2f83569d5935531c4a012b2a985a3b1f9977ffed59f3b",
    ),
    ("student.shop_order_confirmed", "en"): (
        "2f4dfd80dc3bd67eaebb2ef4a32a4e44a75b8ca471c40bbb779f91c0dc50627f",
    ),
    ("student.shop_order_confirmed", "es"): (
        "39688e9f36be36377308eb4e464268467943d7434a79f8651cd26c564efeb504",
    ),
    ("student.shop_order_confirmed", "fr"): (
        "937dffbebb55554beb2e49b185bbe3b11b59e7fbdc85b921b255172217752a3f",
    ),
    ("student.shop_order_confirmed", "it"): (
        "d30c1bc5f255666afd008f9aff6b5283c1ace9f01f679fb3bc66dd6885a9abc0",
    ),
    ("student.we_miss_you_1m", "de"): (
        "858ed977ed97a052231132ecfa78f226fcde5bc9bdc947d4e566d8e383843f10",
    ),
    ("student.we_miss_you_1m", "en"): (
        "4dd4b39b80cbb8461561bd1cb4a53418b093dc541f34c120f7baf3d8d2aac10c",
    ),
    ("student.we_miss_you_1m", "es"): (
        "6e8cfe32f6e66dafab3c4d2b0842791f65610cca0e2e8fd103c6c95910279f9c",
    ),
    ("student.we_miss_you_1m", "fr"): (
        "43ce90c15a8395a8143b5d8f0f4c9728e618cc51e52c52d5251b921ab51dbb10",
    ),
    ("student.we_miss_you_1m", "it"): (
        "dd2257d3ca01a2d82b46afc759941fe4b5e580cdac1cef6cbb3c23ff0b5838a8",
    ),
    ("student.we_miss_you_3m", "de"): (
        "7831f863d2d2774c9dcdc33b567241580c5a6304285e93f620623a04b6cb913c",
    ),
    ("student.we_miss_you_3m", "en"): (
        "e9bb5611516cc1d3f3a3c4f866b22b12c726194fe0e8bb39a5f44e16d1bd1c5a",
    ),
    ("student.we_miss_you_3m", "es"): (
        "ce15bccf9dca4f4dfed6bc8983aa900708d01434a2576bd07435fe7716b7e529",
    ),
    ("student.we_miss_you_3m", "fr"): (
        "d95f90cfc91b50d6a3949067601fc6399d53a8efda785688db1759818bd46b9d",
    ),
    ("student.we_miss_you_3m", "it"): (
        "b6f2bee2bf302630ce3575daddb7a8e5a2cc57c38688ffaa5a28ced7c1da9163",
    ),
    ("student.welcome", "de"): (
        "000f0a67b263b57592a754302ea63e1eb6bbe0a39643dafc35b6b50fc9ac59ae",
    ),
    ("student.welcome", "en"): (
        "f3b914a6dbc6aed55497c92e03fb968b40f76e4497a3375165048f314f03c8a0",
    ),
    ("student.welcome", "es"): (
        "e3ec3e729efee12badcc921f373abf25f058ebd3e687d4ed7d0d6ebdf6ac691d",
    ),
    ("student.welcome", "fr"): (
        "f65022b5f8e3ed22f9eb4e4c9ad37bfef17eca012a31e968035bcf82fdf50c6d",
    ),
    ("student.welcome", "it"): (
        "529b831b822b6c5232911c9ff70051b461c0b84635f9c520dcb5f26667fddf50",
    ),
    ("team_invite", "de"): (
        "36c3161c3164850a2cd4e5244f9913c55bca0ea85a39098fa4e042d2d362ac47",
        "6fd019c5ac8fbb887f272aaf60faaa2922072b03671223bd78f70526aa89c41d",
        "f1b70a1aec9fd2a1755cc593dc3d7b42d2852b19950ade35cca8a0dd17422e71",
    ),
    ("team_invite", "en"): (
        "237a1f2d0927ff877d8ddc29cf8039c1785ab73591a8d9150e9d39f0081171ff",
        "3c5703327190ef89e8ab4135770b2e365810496bc81aaaef27b3586bd2a9dd89",
        "723e2453fe4a097a9dffc771dec1d48a40f7c468d6d9290b9135412c11fb7fa0",
    ),
    ("team_invite", "es"): (
        "1cada2772bdbbfe6e0bd99a47591391d5b0daec40d355752d5611128f7616d4b",
        "9dd58f91a7fae77312ba8d1c67cdce50331c97b681f4353cf9aed83d10fb4e4d",
        "db6c631c79dcba3b69db5d7b5eff7548ad69ed739523d9f4465b7883e0695e83",
    ),
    ("team_invite", "fr"): (
        "3ad42f29ffa57f32faaba802661d0059849736ea82cda0ab9a3fe6297bc1efdb",
        "5860203aafcc2e5533e98013a1347fe21d59f214af36cd26af72fdb5d1ddc67a",
        "911bbe067141a898015abb4192da13747e6676cf56b6c43f4fa1406492f71ac0",
    ),
    ("team_invite", "it"): (
        "0dd178c615cdd801f0ffb4bb18977fd5a9dca05fb01a626e0f41cd4d6aa80730",
        "ad1014d35618536fabe2d32c0d90db739465d5cae164f9bdc2af67e311bc1b07",
        "fb32286f9bc4bf97d5c407f6ec70ca97739d941cdc1396b48ec8d74db980aae1",
    ),
}
