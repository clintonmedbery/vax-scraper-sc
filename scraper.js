const puppeteer = require('puppeteer')
const firebase = require('firebase/app')
const dayjs = require('dayjs')
const _ = require('lodash')
const zipcodes = require('zipcodes-nearby')

// Add the Firebase products that you want to use
require('firebase/auth')
require('firebase/firestore')

const zipData = require('./data/sc-zips.json')
require('dotenv').config()

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const twilio = require('twilio')(accountSid, authToken)

let firebaseConfig = {
  apiKey: process.env.GOOGLE_API_KEY,
  authDomain: process.env.FB_AUTH_DOMAIN,
  projectId: process.env.PROJECT_ID,
  storageBucket: process.env.STORAGE_BUCKET,
  messagingSenderId: process.env.MESSAGING_SENDER_ID,
  appId: process.env.APP_ID,
  measurementId: process.env.MEASUREMENT_ID
}

// Initialize Firebase
firebase.initializeApp(firebaseConfig)

;(async () => {
  const puppeteerOptions = {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // <- this one doesn't works in Windows
      '--disable-gpu'
    ],
    headless: true
  }
  const browser = await puppeteer.launch(puppeteerOptions)
  const page = await browser.newPage()
  const grab = async () => {
    setTimeout(async () => {
      console.log('Starting scrape at:', dayjs().format())
      await page.goto('https://cvas.dhec.sc.gov/health/CovidVaccineScheduling/SelectLocation', { waitUntil: 'networkidle2' })
      let cityData = zipData.map((x) => x.fields)

      let availableLocations = await page.evaluate(() => {
        let data = []
        let elements = document.getElementsByClassName('btn-outline-primary')
        for (var element of elements) {
          let inner = element.innerHTML
          inner = inner.replace('</b>', '')
          inner = inner.replace('<b>', '')

          let locArray = inner.split('<br>')

          let name = locArray[0]
          let streetAddress = locArray[1]
          let cityStateZip = locArray[2]

          data.push({ name, streetAddress, cityStateZip })
        }
        return data
      })

      let availableLocMap = {}

      availableLocations.forEach((loc) => {
        let zipArray = loc.cityStateZip.split(' ')
        let zip = zipArray.length > 1 ? zipArray[zipArray.length - 1] : ''
        let info = _.find(cityData, (item) => item.zip == zip)
        availableLocMap[zip] = { ...loc, latitude: info && info.latitude, longitude: info && info.longitude }
      })

      let availableZips = Object.keys(availableLocMap)

      const usersRef = firebase.firestore().collection('users')
      const snapshot = await usersRef.get()

      if (snapshot.empty) {
        console.log('No matching documents.')
        return
      }

      const userData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }))

      userData.forEach((user) => {
        let info = _.find(cityData, (item) => item.zip == user.zipCode)

        if (!info) {
          //Need to handle this
          return
        }

        try {
          zipcodes
            .near(user.zipCode, 45000, { datafile: 'data/sc-zips.csv', zipcode: 'Zip', long: 'Longitude', lat: 'Latitude' })
            .then((nearby) => {
              let intersection = _.intersection(availableZips, nearby)

              if (intersection.length > 0) {
                let name = availableLocMap[intersection[0]].name
                console.log(`FOUND A MATCH AT ${name}`)
                let now = dayjs()
                let lastDate = dayjs(user.lastContacted)
                let diff = now.diff(lastDate, 'minute')
                console.log(user)
                //Not trying to blow up phones.
                if (user.lastContacted && Math.abs(diff) < 30) {
                  console.log('Texted user not long ago.')
                  return
                }
                try {
                  if (process.env.ENVIRONMENT === 'dev') {
                    console.log(`DEV MATCH FOUND for ${user.phoneNumber} at ${name}`)
                  } else {
                    console.log(`MATCH FOUND for ${user.phoneNumber} at ${name}`)
                    twilio.messages
                      .create({
                        body: `Available Appointment at ${intersection.join(
                          ', '
                        )}. Go to https://cvas.dhec.sc.gov/Health/CovidVaccineScheduling and choose ${name}. Text STOP to unsubscribe.`,
                        from: process.env.TWILIO_PHONE_NUMBER,
                        to: user.phoneNumber
                      })
                      .then((message) => {
                        console.log('MESSAGE SENT:', message.sid)
                        firebase
                          .firestore()
                          .collection('users')
                          .doc(user.id)
                          .update({ ...user, lastContacted: dayjs().valueOf() })
                      })
                      .catch((e) => {
                        console.error('Twilio Error:', e)
                      })
                  }
                } catch (e) {
                  console.error(e)
                }
              }
            })
            .catch((e) => console.log('Nearby Error', e))
        } catch (e) {
          console.log(e)
        }
      })

      await grab()
    }, process.env.RELOAD_TIME || 60000)
  }
  await grab()
})()
