### Vaccine Scraper for South Carolina
#### Currently only supports https://cvas.dhec.sc.gov/health/CovidVaccineScheduling/SelectLocation

Installation

1) Needs a .env file for Firebase etc.

Sample:
```
    GOOGLE_API_KEY = AIzaBlahBlah
    FB_AUTH_DOMAIN = app-name.firebaseapp.com
    PROJECT_ID = app-name
    STORAGE_BUCKET = appname.appspot.com
    MESSAGING_SENDER_ID = 3221212312
    APP_ID = 1asdase23oasd
    MEASUREMENT_ID = G-asdas3123
    TWILIO_AUTH_TOKEN = q312ansd128asjdasd
    TWILIO_PHONE_NUMBER = +15555555555
```

```yarn install```

```npm run start```


This app scrapes available appointment areas off the web and sees who might be in the area and texts them.
