/**
 * @file pump_controller.ino
 * @brief Smart Dispensing Pump & Flow Sensor Controller for Arduino
 */

#include <EEPROM.h>

const int FLOW_SENSOR_PIN = 2;  // Interrupt pin (YF-S201 yellow wire)
const int RELAY_PUMP_PIN  = 7;  // Relay 1: Pump motor
const int RELAY_VALVE_PIN = 8;  // Relay 2: Solenoid valve
const int FLOAT_SENSOR_PIN = A0; // Tank float switch

volatile unsigned long pulseCounter = 0;
float kFactor = 4.5; // pulses per mL
const int EEPROM_ADDR_KFACTOR = 0;

enum DispenseState { STATE_IDLE, STATE_DISPENSING, STATE_PAUSED, STATE_COMPLETED, STATE_ESTOP };
DispenseState currentState = STATE_IDLE;
unsigned long targetPulses = 0;
unsigned long targetMl = 0;
unsigned long dispenseStartTime = 0;
unsigned long lastTelemetryTime = 0;

void IRAM_ATTR pulseISR() {
  pulseCounter++;
}

void setup() {
  Serial.begin(115200);
  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), pulseISR, RISING);
  pinMode(RELAY_PUMP_PIN, OUTPUT);
  pinMode(RELAY_VALVE_PIN, OUTPUT);
  pinMode(FLOAT_SENSOR_PIN, INPUT_PULLUP);
  digitalWrite(RELAY_PUMP_PIN, LOW);
  digitalWrite(RELAY_VALVE_PIN, LOW);

  float savedK;
  EEPROM.get(EEPROM_ADDR_KFACTOR, savedK);
  if (!isnan(savedK) && savedK > 0.5 && savedK < 50.0) {
    kFactor = savedK;
  }
  Serial.println(F("SYSTEM:READY:PUMP_CONTROLLER_V2.1"));
}

void loop() {
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.startsWith("START:")) {
      long ml = cmd.substring(6).toInt();
      if (ml > 0) {
        targetMl = ml;
        targetPulses = (unsigned long)(targetMl * kFactor);
        pulseCounter = 0;
        currentState = STATE_DISPENSING;
        dispenseStartTime = millis();
        digitalWrite(RELAY_VALVE_PIN, HIGH);
        delay(50);
        digitalWrite(RELAY_PUMP_PIN, HIGH);
        Serial.print(F("OK:STARTED:"));
        Serial.println(targetMl);
      }
    } else if (cmd == "STOP" || cmd == "CANCEL") {
      digitalWrite(RELAY_PUMP_PIN, LOW);
      digitalWrite(RELAY_VALVE_PIN, LOW);
      currentState = STATE_IDLE;
      Serial.println(F("OK:STOPPED"));
    } else if (cmd == "ESTOP") {
      digitalWrite(RELAY_PUMP_PIN, LOW);
      digitalWrite(RELAY_VALVE_PIN, LOW);
      currentState = STATE_ESTOP;
      Serial.println(F("ERR:ESTOP"));
    } else if (cmd == "PING") {
      Serial.println(F("PONG"));
    }
  }

  if (currentState == STATE_DISPENSING) {
    if (pulseCounter >= targetPulses) {
      digitalWrite(RELAY_PUMP_PIN, LOW);
      digitalWrite(RELAY_VALVE_PIN, LOW);
      currentState = STATE_COMPLETED;
      Serial.print(F("DONE:DISPENSED:"));
      Serial.println((int)(pulseCounter / kFactor));
    }
  }

  if (millis() - lastTelemetryTime >= 250) {
    lastTelemetryTime = millis();
    Serial.print(F("STATUS:FLOW="));
    Serial.print(currentState == STATE_DISPENSING ? 2.8 : 0.0, 2);
    Serial.print(F(":ML="));
    Serial.print(pulseCounter / kFactor, 1);
    Serial.print(F(":PULSES="));
    Serial.println(pulseCounter);
  }
}
