/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as admin from "firebase-admin";
import { Database } from "firebase-admin/database";
import { CollectionReference } from "firebase-admin/firestore";
import * as functions from "firebase-functions";

admin.initializeApp({
  databaseURL: "https://sleep-stage-f670f-default-rtdb.firebaseio.com",
  credential: admin.credential.cert(
    "sleep-stage-f670f-firebase-adminsdk-dnogt-5bb301c247.json"
  ),
});

/// 카카오 로그인
exports.kakaoToken = functions
  .region("asia-northeast3")
  .https.onRequest(async (req, res) => {
    console.log(req.body);
    var token = await createFirebaseToken(res, req.body["data"]);
    res.send({ status: true, data: token });
  });

exports.test = functions
  .region("asia-northeast3")
  .https.onRequest(async (req, res) => {
    await updateSchedule();
    res.send({ status: true, data: "token" });
  });

/// 수면 일정
exports.convertDatetime = functions
  .region("asia-northeast3")
  .pubsub.schedule("every 5 minutes")
  .onRun(async (context) => {
    await updateSchedule();
  });

async function updateOrCreateUser(res: functions.Response, updateParams: any) {
  try {
    await admin.auth().getUser(updateParams["uid"]);
  } catch (error: any) {
    if (error.code === "auth/user-not-found") {
      try {
        await admin.auth().createUser(updateParams);
      } catch (error: any) {
        res.send({ status: false, data: error.code });
      }
    }
  }
}

async function createFirebaseToken(res: functions.Response, kakaoResult: any) {
  const userId = `kakao:${kakaoResult["id"]["value"]}`;

  const updateParams = {
    uid: userId,
    provider: "KAKAO",
    displayName: kakaoResult["properties"]["nickname"],
    email: kakaoResult["kakao_account"]["email"],
  };

  await updateOrCreateUser(res, updateParams);

  return admin.auth().createCustomToken(userId, { provider: "KAKAO" });
}

async function updateSchedule() {
  const db = admin.firestore().collection("device");
  const database = admin.database();
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const koreaTimeDiff = 9 * 60 * 60 * 1000;
  const korNow = new Date(utc + koreaTimeDiff);
  const time = Number(
    `${korNow.getHours()}${korNow.getMinutes().toString().padStart(2, "0")}`
  );

  const tenBefore = new Date(utc + koreaTimeDiff);
  tenBefore.setMinutes(korNow.getMinutes() - 10);
  const timeBefore = Number(
    `${tenBefore.getHours()}${tenBefore
      .getMinutes()
      .toString()
      .padStart(2, "0")}`
  );

  const tenAfter = new Date(utc + koreaTimeDiff);
  tenAfter.setMinutes(korNow.getMinutes() + 10);

  const timeAfter = Number(
    `${tenAfter.getHours()}${tenAfter.getMinutes().toString().padStart(2, "0")}`
  );

  const prevDay = new Date(utc + koreaTimeDiff);
  prevDay.setDate(prevDay.getDate() - 1);

  await checkBedTime(
    db,
    "single",
    "TEMP",
    getDay(korNow.getDay()),
    time,
    timeBefore,
    korNow,
    database
  );

  await checkBedTime(
    db,
    "left",
    "LEFT_TEMP",
    getDay(korNow.getDay()),
    time,
    timeBefore,
    korNow,
    database
  );

  await checkBedTime(
    db,
    "right",
    "RIGHT_TEMP",
    getDay(korNow.getDay()),
    time,
    timeBefore,
    korNow,
    database
  );

  await checkWakeUpTime(
    db,
    "single",
    "TEMP",
    getDay(korNow.getDay()),
    time,
    timeAfter,
    database
  );

  await checkWakeUpTime(
    db,
    "left",
    "LEFT_TEMP",
    getDay(korNow.getDay()),
    time,
    timeAfter,
    database
  );

  await checkWakeUpTime(
    db,
    "right",
    "RIGHT_TEMP",
    getDay(korNow.getDay()),
    time,
    timeAfter,
    database
  );

  await checkPrevDayWakeUpTime(
    db,
    "single",
    "TEMP",
    getDay(prevDay.getDay()),
    time + 2400,
    timeAfter + 2400,
    database
  );

  await checkPrevDayWakeUpTime(
    db,
    "left",
    "LEFT_TEMP",
    getDay(prevDay.getDay()),
    time + 2400,
    timeAfter + 2400,
    database
  );

  await checkPrevDayWakeUpTime(
    db,
    "right",
    "RIGHT_TEMP",
    getDay(prevDay.getDay()),
    time + 2400,
    timeAfter + 2400,
    database
  );
}

function getDay(index: number) {
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return days[index];
}

async function checkBedTime(
  db: CollectionReference,
  position: string,
  positionTemp: string,
  day: string,
  time: number,
  timeBefore: number,
  korNow: Date,
  database: Database
) {
  var query = db.where(`${position}.${day}.bedTime`, "<=", time);
  if (time > timeBefore) {
    query = query.where(`${position}.${day}.bedTime`, ">=", timeBefore);
  }
  const snapshot = await query.get();

  const dateNoTime = new Date(
    korNow.getFullYear(),
    korNow.getMonth(),
    korNow.getDate(),
    9
  ).getTime();

  console.log(dateNoTime);

  snapshot.docs.forEach((value) => {
    if (value.data()[position][day]["turnOn"] == true) {
      db.doc(value.id)
        .collection("schedule")
        .doc(dateNoTime.toString())
        .set(
          {
            [position]: {
              betTime: value.data()[position][day]["bedTime"],
              wakeUpTime: value.data()[position][day]["wakeUpTime"],
            },
          },
          { merge: true }
        );

      database
        .ref(`devices/${value.id}`)
        .update({ [positionTemp]: value.data()[position][day]["temp"] });
    }
  });
}
async function checkWakeUpTime(
  db: CollectionReference,
  position: string,
  positionTemp: string,
  day: string,
  time: number,
  timeAfter: number,

  database: Database
) {
  console.log(time);
  console.log(timeAfter);
  var query = db.where(`${position}.${day}.wakeUpTime`, ">=", time);
  if (time < timeAfter) {
    query = query.where(`${position}.${day}.wakeUpTime`, "<=", timeAfter);
  }

  const snapshot = await query.get();

  snapshot.docs.forEach((value) => {
    if (value.data()[position][day]["turnOn"] == true) {
      database.ref(`devices/${value.id}`).update({ [positionTemp]: 25 });
    }
  });
}
async function checkPrevDayWakeUpTime(
  db: CollectionReference,
  position: string,
  positionTemp: string,
  day: string,
  time: number,
  timeAfter: number,
  database: Database
) {
  var query = db.where(`${position}.${day}.wakeUpTime`, ">=", time);
  if (time < timeAfter) {
    query = query.where(`${position}.${day}.wakeUpTime`, "<=", timeAfter);
  }

  const snapshot = await query.get();

  snapshot.docs.forEach((value) => {
    if (value.data()[position][day]["turnOn"] == true) {
      database.ref(`devices/${value.id}`).update({ [positionTemp]: 25 });
    }
  });
}
