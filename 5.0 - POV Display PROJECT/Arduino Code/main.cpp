#include <WiFi.h>
#include <FirebaseESP32.h>

#define FIREBASE_HOST "YourFirebaseHost"
#define FIREBASE_AUTH "YourFirebaseAuth"
#define WIFI_SSID "wifi_ssid"
#define WIFI_PASSWORD "Wifi_password"

#define NUM_LEDS 12

#define PIN_LED1 27
#define PIN_LED2 26
#define PIN_LED3 25
#define PIN_LED4 33
#define PIN_LED5 32
#define PIN_LED6 12
#define PIN_LED7 14
#define PIN_LED8 5
#define PIN_LED9 18
#define PIN_LED10 19
#define PIN_LED11 21
#define PIN_LED12 17

const int ledPins[] = {PIN_LED1, PIN_LED2, PIN_LED3, PIN_LED4, PIN_LED5, PIN_LED6, 
                      PIN_LED7, PIN_LED8, PIN_LED9, PIN_LED10, PIN_LED11, PIN_LED12};

FirebaseData firebaseData;
double RPS = 6.349;

using namespace std;

//Function to parse the image data string to an array of 1's and 0's
vector<vector<int>> parseStringToArray(const String& data, int width) {
  int index = 0;
  vector<vector<int>> dataArray;
  for (int i = 0; i < NUM_LEDS; ++i) {
    vector<int> inner;
    for (int j = 0; j < width; ++j) {
      int nextComma = data.indexOf(',', index);
      if (nextComma == -1) {
        nextComma = data.length();
      }
      String valueString = data.substring(index, nextComma);
      inner.push_back((int)valueString.toInt());
      index = nextComma + 1;
    }
    dataArray.push_back(inner);
  }
  return dataArray;
}

//Function to start drawing the whole parsed image only once!
void drawRadialLEDStrip(vector<vector<int>> dataArray, int width, int calcDelay) {
  for (int i = width - 1; i >= 0; --i) {
    for (int j = NUM_LEDS - 1; j >= 0 ; --j) {
      digitalWrite(ledPins[NUM_LEDS - j - 1], dataArray[j][i]);
    }
    delayMicroseconds(calcDelay);
  }
}

void setup() {
  //Set LED pins mode
  for (int i = 0; i < NUM_LEDS; ++i) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);
  }
  
  Serial.begin(115200);

  // Connect to wifi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }
  Serial.println("\nConnected to WiFi");

  //Initialize firebase connection
  Firebase.begin(FIREBASE_HOST, FIREBASE_AUTH);
  firebaseData.setResponseSize(16384);

  if (!Firebase.ready()) {
    Serial.println("Firebase not ready, exiting...");
    while (1);
  }
}

void loop() {
  String counterPath = "/imageCounter";
  bool counterRead = Firebase.getInt(firebaseData, counterPath);
  int counter = firebaseData.intData();
  if (counterRead && Firebase.getString(firebaseData, "/images")) {
    if (counter == 0) {
      counter = 3;
    }

    for (int i = 0; i < counter; i++) {
      if (!Firebase.getString(firebaseData, "/images")){
        break;
      }
      String basePath = "/images/image" + String(i);
      String path = basePath + "/ledMatrix";
      String widthPath = basePath + "/imageWidth";
      Serial.println(path);
      
      Firebase.getString(firebaseData, path);
      String arrStr = firebaseData.stringData();
      
      Firebase.getInt(firebaseData, widthPath);
      int width = firebaseData.intData();

      vector<vector<int>> dataArray = parseStringToArray(arrStr, width);
      
      //Calculate delay for each column of pixils in microseconds
      int calcDelay = 1 / RPS / width * 1000000;
      Serial.println(calcDelay);
      
      unsigned long start = millis();
      while (true) {
        drawRadialLEDStrip(dataArray, width, calcDelay);
        if (millis() - start >= 60000) {
          Firebase.getInt(firebaseData, counterPath);
          counter = firebaseData.intData();
          if (counter == 0) {
            counter = 3;
          }
          break;
        }
      }
    } 
  } else {
    Serial.println("FIREBASE DATA NOT AVAILABLE");

    String path = "/noImage/ledMatrix";
    String widthPath = "/noImage/imageWidth";
    
    if (Firebase.getString(firebaseData, path)) {
      String arrStringNoImage = firebaseData.stringData();
      
      Firebase.getInt(firebaseData, widthPath);
      int width = firebaseData.intData();
      
      vector<vector<int>> dataArray = parseStringToArray(arrStringNoImage, width);
      
      int calcDelay = 1 / RPS / width * 1000000;
      
      unsigned long start = millis();
      while (true) {
        drawRadialLEDStrip(dataArray, width, calcDelay);
        if (millis() - start >= 15000) {
          break;
        }
      }
    }
  }
}