# Daily 3

하루에 딱 3가지 목표만 입력하고 완료 체크하는 미니멀 일일 목표 관리 웹앱입니다.

## 스택

- Vanilla JavaScript + Vite
- Firebase v9 Modular SDK
- Firebase Authentication Google 로그인
- Firebase Realtime Database
- 직접 작성한 CSS
- Vercel 정적 배포

## 용량 최소화 방향

- Firebase Storage, Firestore, Analytics를 사용하지 않습니다.
- Realtime Database는 사용자별 최근 90일 기록과 통계만 1회 읽기합니다.
- 목표 텍스트는 80자로 제한하고 하루 목표는 최대 3개만 저장합니다.
- 구글 프로필 사진 URL은 DB에 저장하지 않고 Auth 사용자 정보에서만 표시합니다.
- 실시간 리스너를 두지 않아 불필요한 다운로드를 줄였습니다.

## 설치

```bash
npm install
npm run dev
```

## 환경변수

`.env.example`을 참고해 `.env`를 만들고 Firebase 웹 앱 설정값을 넣어 주세요.

```bash
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your_project_id-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Vercel에는 같은 값을 Project Settings > Environment Variables에 등록하면 됩니다.

## Firebase 설정

1. Firebase Console에서 프로젝트를 만듭니다.
2. Authentication > Sign-in method에서 Google을 활성화합니다.
3. Authentication > Settings > Authorized domains에 Vercel 배포 도메인을 추가합니다.
4. Realtime Database를 생성합니다.
5. Realtime Database > Rules에 `database.rules.json` 내용을 붙여 넣습니다.

## Realtime Database Rules

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        "$other": {
          ".validate": false
        },
        "profile": {
          ".validate": "newData.hasChildren(['name', 'email', 'createdAt']) && newData.childrenCount() === 3",
          "name": {
            ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 80"
          },
          "email": {
            ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 160"
          },
          "createdAt": {
            ".validate": "newData.isNumber() && newData.val() > 0"
          }
        },
        "days": {
          "$date": {
            ".validate": "newData.hasChildren(['completionRate', 'goalCount', 'restDay', 'updatedAt']) && newData.childrenCount() <= 5",
            "$other": {
              ".validate": false
            },
            "goals": {
              ".validate": "newData.childrenCount() <= 3",
              "$goalId": {
                ".validate": "($goalId === 'g1' || $goalId === 'g2' || $goalId === 'g3') && newData.hasChildren(['text', 'done']) && newData.childrenCount() === 2",
                "text": {
                  ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 80"
                },
                "done": {
                  ".validate": "newData.isBoolean()"
                }
              }
            },
            "completionRate": {
              ".validate": "newData.isNumber() && (newData.val() === 0 || newData.val() === 0.33 || newData.val() === 0.67 || newData.val() === 1)"
            },
            "goalCount": {
              ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 3"
            },
            "restDay": {
              ".validate": "newData.isBoolean()"
            },
            "updatedAt": {
              ".validate": "newData.isNumber() && newData.val() > 0"
            }
          }
        },
        "stats": {
          ".validate": "newData.hasChildren(['currentStreak', 'longestStreak', 'totalActiveDays', 'updatedAt']) && newData.childrenCount() === 4",
          "currentStreak": {
            ".validate": "newData.isNumber() && newData.val() >= 0"
          },
          "longestStreak": {
            ".validate": "newData.isNumber() && newData.val() >= 0"
          },
          "totalActiveDays": {
            ".validate": "newData.isNumber() && newData.val() >= 0"
          },
          "updatedAt": {
            ".validate": "newData.isNumber() && newData.val() > 0"
          }
        }
      }
    }
  }
}
```

## 데이터 구조

```txt
users/{uid}
  profile
    name
    email
    createdAt
  days/{yyyy-mm-dd}
    goals
      g1
        text
        done
      g2
        text
        done
      g3
        text
        done
    completionRate
    goalCount
    restDay
    updatedAt
  stats
    currentStreak
    longestStreak
    totalActiveDays
    updatedAt
```

## 배포

```bash
npm run build
```

GitHub에 업로드한 뒤 Vercel에서 Import Project를 선택하고, 환경변수를 등록한 다음 배포하면 됩니다.
